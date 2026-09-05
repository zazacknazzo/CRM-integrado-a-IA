import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePhone } from '../core/phone.ts';
import { shouldAdvanceStatus } from '../core/status.ts';
import { verifyMetaSignature } from '../core/crypto.ts';
import { parseMetaWebhook } from '../lib/meta-webhook.ts';

test('normalizes Brazilian phone variants conservatively', () => {
  assert.equal(normalizePhone('+55 11 99999-9999'), '+5511999999999');
  assert.equal(normalizePhone('5511999999999'), '+5511999999999');
  assert.equal(normalizePhone('(11) 99999-9999'), '+5511999999999');
  assert.equal(normalizePhone('119920847171'), null);
  assert.equal(normalizePhone('123'), null);
});

test('verifies Meta HMAC SHA-256 signatures', async () => {
  const body = '{"object":"whatsapp_business_account"}';
  const secret = 'test-secret';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const signature = `sha256=${[...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  assert.equal(await verifyMetaSignature(body, signature, secret), true);
  assert.equal(await verifyMetaSignature(`${body}x`, signature, secret), false);
  assert.equal(await verifyMetaSignature(body, null, secret), false);
});

test('never regresses asynchronous message status', () => {
  assert.equal(shouldAdvanceStatus('sent', 'delivered'), true);
  assert.equal(shouldAdvanceStatus('delivered', 'sent'), false);
  assert.equal(shouldAdvanceStatus('read', 'failed'), false);
  assert.equal(shouldAdvanceStatus('failed', 'delivered'), true);
});

test('parses inbound text and status events without mixing them', () => {
  const parsed = parseMetaWebhook({ entry: [{ changes: [{ value: {
    contacts: [{ wa_id: '5511999999999', profile: { name: 'Marina' } }],
    messages: [{ id: 'wamid.in', from: '5511999999999', timestamp: '1720000000', type: 'text', text: { body: 'Olá' } }],
    statuses: [{ id: 'wamid.out', timestamp: '1720000010', status: 'delivered' }],
  } }] }] });
  assert.equal(parsed.messages.length, 1);
  assert.equal(parsed.messages[0].profileName, 'Marina');
  assert.equal(parsed.messages[0].text, 'Olá');
  assert.equal(parsed.statuses[0].status, 'delivered');
});
