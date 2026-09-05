import type { MessageStatus } from './contracts.ts';

const statusRank: Record<MessageStatus, number> = { queued: 0, sent: 1, delivered: 2, read: 3, failed: 2 };

export function shouldAdvanceStatus(current: MessageStatus, incoming: MessageStatus): boolean {
  if (current === 'read') return false;
  if (incoming === 'failed') return current === 'queued' || current === 'sent';
  if (current === 'failed') return incoming === 'delivered' || incoming === 'read';
  return statusRank[incoming] > statusRank[current];
}
