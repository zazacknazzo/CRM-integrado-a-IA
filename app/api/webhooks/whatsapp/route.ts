import { waitUntil } from 'cloudflare:workers';
import { sha256, verifyMetaSignature } from '../../../../core/crypto.ts';
import { logError, logEvent } from '../../../../core/logger.ts';
import { processInboundMessage } from '../../../../core/pipeline.ts';
import { getRuntimeEnv } from '../../../../db/index.ts';
import { parseMetaWebhook } from '../../../../lib/meta-webhook.ts';
import { createRuntime } from '../../../../lib/runtime.ts';

export async function GET(request: Request) {
  const env = getRuntimeEnv();
  const url = new URL(request.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  if (!env.WHATSAPP_VERIFY_TOKEN)
    return new Response('WHATSAPP_VERIFY_TOKEN missing', { status: 503 });
  if (mode === 'subscribe' && token === env.WHATSAPP_VERIFY_TOKEN && challenge)
    return new Response(challenge, { status: 200 });
  logEvent('webhook_verification_failed');
  return new Response('Webhook verification failed', { status: 403 });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const env = getRuntimeEnv();
  if (!env.META_APP_SECRET)
    return Response.json({ error: 'META_APP_SECRET missing' }, { status: 503 });
  const valid = await verifyMetaSignature(
    rawBody,
    request.headers.get('x-hub-signature-256'),
    env.META_APP_SECRET,
  );
  if (!valid) {
    logEvent('webhook_signature_invalid');
    return Response.json(
      { error: 'Webhook signature invalid' },
      { status: 401 },
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }
  const parsed = parseMetaWebhook(payload);
  const payloadHash = await sha256(rawBody);
  const { pipeline, repository } = createRuntime();
  await repository.noteIntegration({
    lastWebhookAt: new Date().toISOString(),
    lastError: null,
  });
  logEvent('whatsapp_webhook_received', {
    messages: parsed.messages.length,
    statuses: parsed.statuses.length,
  });

  const background = (async () => {
    let processingFailed = false;
    for (const status of parsed.statuses) {
      const key = `status:${status.externalId}:${status.status}:${status.timestamp}`;
      if (
        !(await repository.recordWebhookEvent(
          key,
          'MESSAGE_STATUS',
          payloadHash,
        ))
      )
        continue;
      try {
        await repository.updateExternalMessageStatus(
          status.externalId,
          status.status,
          status.timestamp,
          status.reason,
        );
        await repository.completeWebhookEvent(key);
        logEvent('whatsapp_message_status_updated', { status: status.status });
      } catch (error) {
        await repository.completeWebhookEvent(
          key,
          error instanceof Error ? error.message : String(error),
        );
        logError('whatsapp_status_processing_failed', error);
        processingFailed = true;
      }
    }

    for (const message of parsed.messages) {
      const key = `message:${message.externalId}`;
      if (
        !(await repository.recordWebhookEvent(
          key,
          'INBOUND_MESSAGE',
          payloadHash,
        ))
      ) {
        logEvent('duplicate_webhook_ignored');
        continue;
      }
      try {
        await processInboundMessage(message, pipeline);
        await repository.completeWebhookEvent(key);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        await repository.completeWebhookEvent(key, detail);
        await repository.noteIntegration({ lastError: detail });
        logError('whatsapp_inbound_processing_failed', error, {
          type: message.type,
        });
        processingFailed = true;
      }
    }
    if (processingFailed)
      throw new Error('One or more inbound messages could not be persisted');
  })();

  waitUntil(background.catch(() => undefined));
  try {
    await background;
    return Response.json({ received: true }, { status: 200 });
  } catch {
    return Response.json(
      { error: 'Inbound processing failed; retry required' },
      { status: 503 },
    );
  }
}
