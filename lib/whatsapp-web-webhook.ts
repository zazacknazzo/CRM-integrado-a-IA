import type { InboundMessageInput, MessageStatus } from '../core/contracts.ts';

export type WhatsAppWebWebhookPayload =
  | { kind: 'message'; message: InboundMessageInput }
  | { kind: 'status'; externalId: string; status: MessageStatus; timestamp: string; reason?: string };

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function parseWhatsAppWebWebhook(value: unknown): WhatsAppWebWebhookPayload | null {
  const payload = object(value);
  if (payload.kind === 'message') {
    const message = object(payload.message);
    const externalId = text(message.externalId);
    const fromPhone = text(message.fromPhone);
    const timestamp = text(message.timestamp);
    const type = text(message.type);
    if (!externalId || !fromPhone || !timestamp || !type) return null;
    return {
      kind: 'message',
      message: {
        ...message,
        externalId,
        channel: 'WHATSAPP',
        fromPhone,
        timestamp,
        type: ['text', 'image', 'audio', 'document', 'location', 'interactive'].includes(type)
          ? type as InboundMessageInput['type']
          : 'unknown',
        profileName: text(message.profileName),
        text: text(message.text),
        mediaId: text(message.mediaId),
      },
    } as { kind: 'message'; message: InboundMessageInput };
  }

  if (payload.kind === 'status') {
    const externalId = text(payload.externalId);
    const status = text(payload.status) as MessageStatus | undefined;
    const timestamp = text(payload.timestamp);
    if (!externalId || !timestamp || !status || !['sent', 'delivered', 'read', 'failed'].includes(status)) return null;
    return { kind: 'status', externalId, status, timestamp, reason: text(payload.reason) };
  }
  return null;
}
