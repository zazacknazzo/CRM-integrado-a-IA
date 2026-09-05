import { waitUntil } from 'cloudflare:workers';
import { sha256, verifyHmacSignature } from '../../../../core/crypto.ts';
import { logError, logEvent } from '../../../../core/logger.ts';
import { processInboundMessage } from '../../../../core/pipeline.ts';
import { getRuntimeEnv } from '../../../../db/index.ts';
import { parseWhatsAppWebWebhook } from '../../../../lib/whatsapp-web-webhook.ts';
import { createRuntime } from '../../../../lib/runtime.ts';

export async function POST(request: Request) {
  const rawBody = await request.text();
  const env = getRuntimeEnv();
  if (env.WHATSAPP_PROVIDER !== 'baileys')
    return Response.json(
      { error: 'WhatsApp Web provider is disabled' },
      { status: 404 },
    );
  if (!env.WHATSAPP_WEB_GATEWAY_SECRET)
    return Response.json(
      { error: 'WHATSAPP_WEB_GATEWAY_SECRET missing' },
      { status: 503 },
    );
  const valid = await verifyHmacSignature(
    rawBody,
    request.headers.get('x-atende-signature'),
    env.WHATSAPP_WEB_GATEWAY_SECRET,
  );
  if (!valid)
    return Response.json(
      { error: 'Webhook signature invalid' },
      { status: 401 },
    );

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }
  const parsed = parseWhatsAppWebWebhook(payload);
  if (!parsed)
    return Response.json(
      { error: 'Invalid WhatsApp Web payload' },
      { status: 400 },
    );

  const payloadHash = await sha256(rawBody);
  const { pipeline, repository } = createRuntime();
  await repository.noteIntegration({
    lastWebhookAt: new Date().toISOString(),
    lastError: null,
  });

  const background = (async () => {
    if (parsed.kind === 'status') {
      const key = `web-status:${parsed.externalId}:${parsed.status}:${parsed.timestamp}`;
      if (
        !(await repository.recordWebhookEvent(
          key,
          'MESSAGE_STATUS',
          payloadHash,
        ))
      )
        return;
      try {
        await repository.updateExternalMessageStatus(
          parsed.externalId,
          parsed.status,
          parsed.timestamp,
          parsed.reason,
        );
        await repository.completeWebhookEvent(key);
      } catch (error) {
        await repository.completeWebhookEvent(
          key,
          error instanceof Error ? error.message : String(error),
        );
        logError('whatsapp_web_status_processing_failed', error);
        throw error;
      }
      return;
    }

    const key = `web-message:${parsed.message.externalId}`;
    if (
      !(await repository.recordWebhookEvent(
        key,
        'INBOUND_MESSAGE',
        payloadHash,
      ))
    ) {
      logEvent('duplicate_webhook_ignored');
      return;
    }
    try {
      await processInboundMessage(parsed.message, pipeline);
      await repository.completeWebhookEvent(key);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await repository.completeWebhookEvent(key, detail);
      await repository.noteIntegration({ lastError: detail });
      logError('whatsapp_web_inbound_processing_failed', error, {
        type: parsed.message.type,
      });
      throw error;
    }
  })();

  waitUntil(background.catch(() => undefined));
  try {
    await background;
    return Response.json({ received: true });
  } catch {
    return Response.json(
      { error: 'Inbound processing failed; retry required' },
      { status: 503 },
    );
  }
}
