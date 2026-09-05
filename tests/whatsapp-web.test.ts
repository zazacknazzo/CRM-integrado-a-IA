import assert from 'node:assert/strict';
import test from 'node:test';
import { WhatsAppWebGatewayChannel } from '../channels/whatsapp-web-gateway-channel.ts';
import { parseWhatsAppWebWebhook } from '../lib/whatsapp-web-webhook.ts';

test('parses a signed-gateway inbound message shape', () => {
  const parsed = parseWhatsAppWebWebhook({
    kind: 'message',
    message: {
      externalId: 'baileys:ABC',
      channel: 'SIMULATOR',
      fromPhone: '5511999999999',
      profileName: 'Cliente',
      type: 'text',
      text: 'Olá',
      timestamp: '2026-09-02T12:00:00.000Z',
    },
  });
  assert.equal(parsed?.kind, 'message');
  if (parsed?.kind !== 'message') return;
  assert.equal(parsed.message.channel, 'WHATSAPP');
  assert.equal(parsed.message.text, 'Olá');
});

test('rejects malformed gateway payloads', () => {
  assert.equal(parseWhatsAppWebWebhook({ kind: 'message', message: { type: 'text' } }), null);
  assert.equal(parseWhatsAppWebWebhook({ kind: 'status', externalId: 'x', status: 'queued', timestamp: 'now' }), null);
});

test('gateway channel sends text with authentication and idempotency', async () => {
  let requestBody: Record<string, unknown> | undefined;
  const request = async (_url: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer secret');
    requestBody = JSON.parse(String(init?.body));
    return Response.json({ externalId: 'baileys:OUT', acceptedAt: '2026-09-02T12:00:00.000Z' });
  };
  const channel = new WhatsAppWebGatewayChannel({ baseUrl: 'http://127.0.0.1:8789', secret: 'secret' }, request as typeof fetch);
  const result = await channel.sendMessage({ to: '+5511999999999', type: 'text', text: 'Oi', idempotencyKey: 'message-1' });
  assert.equal(result.externalId, 'baileys:OUT');
  assert.deepEqual(requestBody, { to: '+5511999999999', text: 'Oi', idempotencyKey: 'message-1' });
});
