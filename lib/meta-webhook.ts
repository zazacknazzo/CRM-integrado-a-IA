import type { InboundMessageInput, MessageStatus, MessageType } from '../core/contracts.ts';

type JsonObject = Record<string, unknown>;

export interface MetaStatusEvent {
  externalId: string;
  status: MessageStatus;
  timestamp: string;
  reason?: string;
}

export interface ParsedMetaWebhook {
  messages: InboundMessageInput[];
  statuses: MetaStatusEvent[];
}

function object(value: unknown): JsonObject {
  return value && typeof value === 'object' ? value as JsonObject : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isoFromUnix(value: unknown): string {
  const seconds = Number(value);
  return Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : new Date().toISOString();
}

function normalizeType(value: unknown): MessageType {
  return ['text', 'image', 'audio', 'document', 'location', 'interactive'].includes(String(value)) ? String(value) as MessageType : 'unknown';
}

function messageText(message: JsonObject, type: MessageType): string | undefined {
  if (type === 'text') return text(object(message.text).body);
  if (type === 'image') return text(object(message.image).caption);
  if (type === 'document') return text(object(message.document).caption) ?? text(object(message.document).filename);
  if (type === 'location') {
    const location = object(message.location);
    return [text(location.name), text(location.address)].filter(Boolean).join(' — ') || undefined;
  }
  if (type === 'interactive') {
    const interactive = object(message.interactive);
    return text(object(interactive.button_reply).title) ?? text(object(interactive.list_reply).title);
  }
  return undefined;
}

function mediaId(message: JsonObject, type: MessageType): string | undefined {
  if (!['image', 'audio', 'document'].includes(type)) return undefined;
  return text(object(message[type]).id);
}

export function parseMetaWebhook(payload: unknown): ParsedMetaWebhook {
  const messages: InboundMessageInput[] = [];
  const statuses: MetaStatusEvent[] = [];

  for (const entryValue of array(object(payload).entry)) {
    for (const changeValue of array(object(entryValue).changes)) {
      const value = object(object(changeValue).value);
      const contacts = array(value.contacts).map(object);
      const contactNames = new Map(contacts.map((contact) => [text(contact.wa_id), text(object(contact.profile).name)]));

      for (const rawMessage of array(value.messages).map(object)) {
        const externalId = text(rawMessage.id);
        const from = text(rawMessage.from);
        if (!externalId || !from) continue;
        const type = normalizeType(rawMessage.type);
        const location = object(rawMessage.location);
        messages.push({
          externalId,
          channel: 'WHATSAPP',
          fromPhone: from,
          profileName: contactNames.get(from),
          type,
          text: messageText(rawMessage, type),
          mediaId: mediaId(rawMessage, type),
          latitude: typeof location.latitude === 'number' ? location.latitude : undefined,
          longitude: typeof location.longitude === 'number' ? location.longitude : undefined,
          interactivePayload: type === 'interactive' ? object(rawMessage.interactive) : undefined,
          referral: Object.keys(object(rawMessage.referral)).length ? object(rawMessage.referral) : undefined,
          timestamp: isoFromUnix(rawMessage.timestamp),
        });
      }

      for (const rawStatus of array(value.statuses).map(object)) {
        const externalId = text(rawStatus.id);
        const status = text(rawStatus.status) as MessageStatus | undefined;
        if (!externalId || !status || !['sent', 'delivered', 'read', 'failed'].includes(status)) continue;
        const firstError = object(array(rawStatus.errors)[0]);
        statuses.push({
          externalId,
          status,
          timestamp: isoFromUnix(rawStatus.timestamp),
          reason: text(firstError.title) ?? text(firstError.message),
        });
      }
    }
  }
  return { messages, statuses };
}
