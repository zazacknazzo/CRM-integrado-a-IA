import type {
  ChannelName,
  ControlState,
  ConversationRepository,
  InboundMessageInput,
  MessageStatus,
  SendMessageResult,
  StoredConversation,
  StoredMessage,
  AgentResult,
} from '../core/contracts.ts';
import { shouldAdvanceStatus } from '../core/status.ts';
import { attentionPriority, normalizeStage } from '../core/commercial.ts';
import {
  cancelFollowUps,
  commercialEvent,
  customerContext,
  recordCommercialInbound,
  recordCommercialReply,
  saveOpportunity,
} from './commercial.ts';
import { resolveBooking } from './booking.ts';

type ConversationRow = {
  id: string;
  client_id: string;
  channel: ChannelName;
  phone_e164: string;
  control_state: ControlState;
  customer_service_window_expires_at: string | null;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  external_id: string | null;
  channel: ChannelName;
  direction: 'INBOUND' | 'OUTBOUND';
  sender_type: 'CUSTOMER' | 'AI' | 'HUMAN';
  message_type: StoredMessage['messageType'];
  body: string | null;
  media_id: string | null;
  status: MessageStatus;
  processing_state: StoredMessage['processingState'];
  processing_attempts: number;
  created_at: string;
};

const now = () => new Date().toISOString();

function conversationFromRow(row: ConversationRow): StoredConversation {
  return {
    id: row.id,
    clientId: row.client_id,
    channel: row.channel,
    phoneE164: row.phone_e164,
    controlState: row.control_state,
    customerServiceWindowExpiresAt: row.customer_service_window_expires_at,
  };
}

function messageFromRow(row: MessageRow): StoredMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    externalId: row.external_id,
    channel: row.channel,
    direction: row.direction,
    senderType: row.sender_type,
    messageType: row.message_type,
    body: row.body,
    mediaId: row.media_id,
    status: row.status,
    processingState: row.processing_state,
    processingAttempts: row.processing_attempts,
    createdAt: row.created_at,
  };
}

export class D1ConversationRepository implements ConversationRepository {
  private readonly db: D1Database;
  private readonly windowHours: number;
  private readonly maxFollowUps: number;
  private readonly followUpWindowDays: number;
  constructor(
    db: D1Database,
    windowHours = 24,
    maxFollowUps = 2,
    followUpWindowDays = 30,
  ) {
    this.db = db;
    this.windowHours = windowHours;
    this.maxFollowUps = maxFollowUps;
    this.followUpWindowDays = followUpWindowDays;
  }

  async getOrCreateConversation(
    input: InboundMessageInput & { phoneE164: string },
  ): Promise<StoredConversation> {
    const timestamp = now();
    const clientId = crypto.randomUUID();
    const inferredSource = input.referral ? 'META_REFERRAL' : 'UNKNOWN';
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO clients
       (id, phone_e164, name, whatsapp_profile_name, name_source, lead_source, lead_source_metadata, promotional_opt_out, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'WHATSAPP', ?, ?, 0, ?, ?)`,
      )
      .bind(
        clientId,
        input.phoneE164,
        input.profileName ?? null,
        input.profileName ?? null,
        inferredSource,
        input.referral ? JSON.stringify(input.referral) : null,
        timestamp,
        timestamp,
      )
      .run();

    const client = await this.db
      .prepare('SELECT id FROM clients WHERE phone_e164 = ?')
      .bind(input.phoneE164)
      .first<{ id: string }>();
    if (!client) throw new Error('Failed to resolve customer');

    if (input.profileName) {
      await this.db
        .prepare(
          `UPDATE clients SET whatsapp_profile_name = ?, name = COALESCE(name, ?), updated_at = ? WHERE id = ?`,
        )
        .bind(input.profileName, input.profileName, timestamp, client.id)
        .run();
    }

    const conversationId = crypto.randomUUID();
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO conversations
       (id, client_id, channel, external_thread_id, control_state, unread_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'AI_ACTIVE', 0, ?, ?)`,
      )
      .bind(
        conversationId,
        client.id,
        input.channel,
        input.fromPhone,
        timestamp,
        timestamp,
      )
      .run();

    const row = await this.db
      .prepare(
        `SELECT c.id, c.client_id, c.channel, cl.phone_e164, c.control_state, c.customer_service_window_expires_at
       FROM conversations c JOIN clients cl ON cl.id = c.client_id WHERE c.client_id = ? AND c.channel = ?`,
      )
      .bind(client.id, input.channel)
      .first<ConversationRow>();
    if (!row) throw new Error('Failed to resolve conversation');
    await commercialEvent(this.db, row.id, 'lead_created', row.id, {
      source: inferredSource,
      channel: input.channel,
    });
    return conversationFromRow(row);
  }

  async insertInbound(conversationId: string, input: InboundMessageInput) {
    const messageId = crypto.randomUUID();
    const metadata = {
      latitude: input.latitude,
      longitude: input.longitude,
      interactivePayload: input.interactivePayload,
    };
    const result = await this.db
      .prepare(
        `INSERT OR IGNORE INTO messages
       (id, conversation_id, external_id, channel, direction, sender_type, message_type, body, media_id, status, processing_state, metadata_json, referral_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'INBOUND', 'CUSTOMER', ?, ?, ?, 'delivered', 'RECEIVED', ?, ?, ?, ?)`,
      )
      .bind(
        messageId,
        conversationId,
        input.externalId,
        input.channel,
        input.type,
        input.text ?? null,
        input.mediaId ?? null,
        JSON.stringify(metadata),
        input.referral ? JSON.stringify(input.referral) : null,
        input.timestamp,
        now(),
      )
      .run();
    const inserted = (result.meta.changes ?? 0) === 1;
    if (inserted) {
      const windowExpires = new Date(
        Date.parse(input.timestamp) + this.windowHours * 60 * 60 * 1000,
      ).toISOString();
      await this.db
        .prepare(
          `UPDATE conversations SET last_customer_message_at = MAX(COALESCE(last_customer_message_at, ''), ?), customer_service_window_expires_at = MAX(COALESCE(customer_service_window_expires_at, ''), ?), unread_count = unread_count + 1, updated_at = ? WHERE id = ?`,
        )
        .bind(input.timestamp, windowExpires, now(), conversationId)
        .run();
      await recordCommercialInbound(
        this.db,
        conversationId,
        messageId,
        input.timestamp,
        input.text ?? '',
      );
    }
    return { inserted, messageId: inserted ? messageId : undefined };
  }

  async listPendingInbound(conversationId: string): Promise<StoredMessage[]> {
    const result = await this.db
      .prepare(
        `SELECT id, conversation_id, external_id, channel, direction, sender_type, message_type, body, media_id, status, processing_state, processing_attempts, created_at
       FROM messages WHERE conversation_id = ? AND direction = 'INBOUND' AND processing_state = 'RECEIVED'
       AND (next_processing_at IS NULL OR next_processing_at <= ?) ORDER BY created_at ASC, id ASC`,
      )
      .bind(conversationId, now())
      .all<MessageRow>();
    return result.results.map(messageFromRow);
  }

  async listRecentMessages(conversationId: string): Promise<StoredMessage[]> {
    const result = await this.db
      .prepare(
        `SELECT id, conversation_id, external_id, channel, direction, sender_type, message_type, body, media_id, status, processing_state, processing_attempts, created_at
       FROM (
         SELECT id, conversation_id, external_id, channel, direction, sender_type, message_type, body, media_id, status, processing_state, processing_attempts, created_at
         FROM messages WHERE conversation_id = ? ORDER BY created_at DESC, id DESC LIMIT 12
       ) ORDER BY created_at ASC, id ASC`,
      )
      .bind(conversationId)
      .all<MessageRow>();
    return result.results.map(messageFromRow);
  }

  async acquireProcessingLock(
    conversationId: string,
    owner: string,
  ): Promise<boolean> {
    const acquiredAt = now();
    const lockUntil = new Date(Date.now() + 120_000).toISOString();
    const result = await this.db
      .prepare(
        `UPDATE conversations SET processing_lock_owner = ?, processing_lock_until = ?
       WHERE id = ? AND (processing_lock_until IS NULL OR processing_lock_until < ? OR processing_lock_owner = ?)`,
      )
      .bind(owner, lockUntil, conversationId, acquiredAt, owner)
      .run();
    return (result.meta.changes ?? 0) === 1;
  }

  async releaseProcessingLock(
    conversationId: string,
    owner: string,
  ): Promise<void> {
    await this.db
      .prepare(
        `UPDATE conversations SET processing_lock_owner = NULL, processing_lock_until = NULL
       WHERE id = ? AND processing_lock_owner = ?`,
      )
      .bind(conversationId, owner)
      .run();
  }

  async claimInboundForResume(messageId: string): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE messages SET processing_state = 'PROCESSING', updated_at = ?
       WHERE id = ? AND direction = 'INBOUND' AND processing_state = 'PROCESSED'
       AND NOT EXISTS (
         SELECT 1 FROM messages outbound
         WHERE outbound.reply_to_message_id = messages.id AND outbound.status IN ('queued', 'sent', 'delivered', 'read')
       )`,
      )
      .bind(now(), messageId)
      .run();
    return (result.meta.changes ?? 0) === 1;
  }

  async markProcessed(messageIds: string[]): Promise<void> {
    if (!messageIds.length) return;
    await this.db.batch(
      messageIds.map((id) =>
        this.db
          .prepare(
            `UPDATE messages SET processing_state = 'PROCESSED', next_processing_at = NULL, processing_error = NULL, updated_at = ? WHERE id = ?`,
          )
          .bind(now(), id),
      ),
    );
  }

  async deferPendingInbound(
    messageIds: string[],
    reason: string,
    retryAt: string,
  ): Promise<void> {
    if (!messageIds.length) return;
    await this.db.batch(
      messageIds.map((id) =>
        this.db
          .prepare(
            `UPDATE messages SET processing_state = 'RECEIVED', processing_attempts = processing_attempts + 1,
       next_processing_at = ?, processing_error = ?, updated_at = ? WHERE id = ? AND direction = 'INBOUND'`,
          )
          .bind(retryAt, reason.slice(0, 500), now(), id),
      ),
    );
  }

  async listRecoverableConversationIds(limit = 20): Promise<string[]> {
    const result = await this.db
      .prepare(
        `SELECT conversation_id FROM messages
       WHERE direction = 'INBOUND' AND processing_state = 'RECEIVED'
       AND (next_processing_at IS NULL OR next_processing_at <= ?)
       GROUP BY conversation_id ORDER BY MIN(created_at) ASC LIMIT ?`,
      )
      .bind(now(), Math.min(100, Math.max(1, limit)))
      .all<{ conversation_id: string }>();
    return result.results.map((row) => row.conversation_id);
  }

  async getConversation(conversationId: string): Promise<StoredConversation> {
    const row = await this.db
      .prepare(
        `SELECT c.id, c.client_id, c.channel, cl.phone_e164, c.control_state, c.customer_service_window_expires_at
       FROM conversations c JOIN clients cl ON cl.id = c.client_id WHERE c.id = ?`,
      )
      .bind(conversationId)
      .first<ConversationRow>();
    if (!row) throw new Error('Conversation not found');
    return conversationFromRow(row);
  }

  async setControlState(
    conversationId: string,
    state: ControlState,
    reason?: string,
  ): Promise<void> {
    const result = await this.db
      .prepare(
        `UPDATE conversations SET control_state = ?, handoff_reason = ?, updated_at = ? WHERE id = ?`,
      )
      .bind(state, reason ?? null, now(), conversationId)
      .run();
    if ((result.meta.changes ?? 0) !== 1)
      throw new Error('Conversation not found');
    if (state !== 'AI_ACTIVE')
      await cancelFollowUps(this.db, conversationId, 'Atendimento humano');
    await this.db
      .prepare(
        'UPDATE opportunities SET next_best_action = ? WHERE conversation_id = ?',
      )
      .bind(
        state === 'AI_ACTIVE'
          ? 'ANSWER_QUESTION'
          : state === 'PROFESSIONAL_HANDOFF'
            ? 'PROFESSIONAL_REVIEW'
            : 'HUMAN_REPLY',
        conversationId,
      )
      .run();
    if (state === 'AI_ACTIVE') {
      await this.db
        .prepare(
          `UPDATE handoffs SET status = 'RESOLVED', resolved_at = ? WHERE conversation_id = ? AND status = 'OPEN'`,
        )
        .bind(now(), conversationId)
        .run();
    }
  }

  async createHandoff(
    conversationId: string,
    triggerMessageId: string | undefined,
    reason: string,
  ): Promise<void> {
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO handoffs (id, conversation_id, trigger_message_id, reason, status, created_at) VALUES (?, ?, ?, ?, 'OPEN', ?)`,
      )
      .bind(
        crypto.randomUUID(),
        conversationId,
        triggerMessageId ?? null,
        reason,
        now(),
      )
      .run();
  }

  async updateOpportunity(
    conversationId: string,
    input: {
      interest: string | null;
      stage: string;
      summary: string;
      nextBestAction?: string;
      objection?: string | null;
      intent?: string;
    },
  ): Promise<void> {
    await saveOpportunity(this.db, conversationId, input);
  }

  async customerContext(conversationId: string) {
    return customerContext(this.db, conversationId);
  }
  async prepareCommercialReply(
    conversationId: string,
    agent: AgentResult,
    triggerId: string,
  ) {
    await commercialEvent(
      this.db,
      conversationId,
      'commercial_reply_prepared',
      triggerId,
      { agent },
      'AI',
    );
  }
  async recoverCommercialReply(conversationId: string, triggerId: string) {
    const prepared = await this.db
      .prepare(
        'SELECT metadata_json FROM audit_events WHERE conversation_id = ? AND dedup_key = ?',
      )
      .bind(conversationId, 'commercial_reply_prepared:' + triggerId)
      .first<{ metadata_json: string }>();
    if (prepared)
      await this.commercialReplySent(
        conversationId,
        (JSON.parse(prepared.metadata_json) as { agent: AgentResult }).agent,
        triggerId,
      );
  }
  async commercialReplySent(
    conversationId: string,
    agent: AgentResult,
    triggerId: string,
  ) {
    await recordCommercialReply(
      this.db,
      conversationId,
      agent,
      triggerId,
      this.maxFollowUps,
      this.followUpWindowDays,
    );
  }
  async resolveBooking(
    conversationId: string,
    messages: StoredMessage[],
    triggerId: string,
    agent?: AgentResult,
  ) {
    return resolveBooking(this.db, conversationId, messages, triggerId, agent);
  }

  async createOutbound(
    conversationId: string,
    input: {
      senderType: 'AI' | 'HUMAN';
      body: string;
      channel: ChannelName;
      replyToMessageId?: string;
    },
  ): Promise<string> {
    const id = crypto.randomUUID();
    const timestamp = now();
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO messages
       (id, conversation_id, channel, direction, sender_type, message_type, body, status, processing_state, reply_to_message_id, created_at, updated_at)
       VALUES (?, ?, ?, 'OUTBOUND', ?, 'text', ?, 'queued', 'PROCESSED', ?, ?, ?)`,
      )
      .bind(
        id,
        conversationId,
        input.channel,
        input.senderType,
        input.body,
        input.replyToMessageId ?? null,
        timestamp,
        timestamp,
      )
      .run();
    await this.db
      .prepare('UPDATE conversations SET updated_at = ? WHERE id = ?')
      .bind(timestamp, conversationId)
      .run();
    if (!input.replyToMessageId) return id;
    const existing = await this.getOutboundByReplyTo(input.replyToMessageId);
    if (!existing)
      throw new Error('Failed to create idempotent outbound message');
    return existing.id;
  }

  async getOutboundByReplyTo(replyToMessageId: string) {
    return this.db
      .prepare(
        `SELECT id, body, status FROM messages WHERE reply_to_message_id = ? AND direction = 'OUTBOUND' LIMIT 1`,
      )
      .bind(replyToMessageId)
      .first<{ id: string; body: string; status: MessageStatus }>();
  }

  async getOutboundMessage(messageId: string) {
    return this.db
      .prepare(
        `SELECT id, body, status FROM messages WHERE id = ? AND direction = 'OUTBOUND' LIMIT 1`,
      )
      .bind(messageId)
      .first<{ id: string; body: string; status: MessageStatus }>();
  }

  async markOutboundAccepted(
    messageId: string,
    result: SendMessageResult,
  ): Promise<void> {
    await this.db
      .prepare(
        `UPDATE messages SET external_id = ?, status = ?, sent_at = ?, updated_at = ? WHERE id = ?`,
      )
      .bind(
        result.externalId,
        result.status,
        result.acceptedAt,
        now(),
        messageId,
      )
      .run();
  }

  async markOutboundFailed(messageId: string, reason: string): Promise<void> {
    await this.db
      .prepare(
        `UPDATE messages SET status = 'failed', failed_at = ?, failure_reason = ?, updated_at = ? WHERE id = ?`,
      )
      .bind(now(), reason.slice(0, 500), now(), messageId)
      .run();
  }

  async updateExternalMessageStatus(
    externalId: string,
    status: MessageStatus,
    at: string,
    reason?: string,
  ): Promise<boolean> {
    const current = await this.db
      .prepare('SELECT status FROM messages WHERE external_id = ?')
      .bind(externalId)
      .first<{ status: MessageStatus }>();
    if (!current || !shouldAdvanceStatus(current.status, status)) return false;
    const result = await this.db
      .prepare(
        `UPDATE messages SET status = ?,
       sent_at = CASE WHEN ? = 'sent' THEN ? ELSE sent_at END,
       delivered_at = CASE WHEN ? = 'delivered' THEN ? ELSE delivered_at END,
       read_at = CASE WHEN ? = 'read' THEN ? ELSE read_at END,
       failed_at = CASE WHEN ? = 'failed' THEN ? ELSE failed_at END,
       failure_reason = CASE WHEN ? = 'failed' THEN ? ELSE failure_reason END,
       updated_at = ? WHERE external_id = ?`,
      )
      .bind(
        status,
        status,
        at,
        status,
        at,
        status,
        at,
        status,
        at,
        status,
        reason?.slice(0, 500) ?? null,
        now(),
        externalId,
      )
      .run();
    return (result.meta.changes ?? 0) === 1;
  }

  async audit(
    conversationId: string | null,
    eventType: string,
    actorType: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO audit_events (id, conversation_id, event_type, actor_type, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        conversationId,
        eventType,
        actorType,
        metadata ? JSON.stringify(metadata) : null,
        now(),
      )
      .run();
  }

  async noteIntegration(input: {
    lastWebhookAt?: string;
    lastError?: string | null;
    lastSuccessfulSendAt?: string;
  }): Promise<void> {
    const timestamp = now();
    await this.db
      .prepare(
        `INSERT INTO integration_status (id, last_webhook_at, last_error, last_successful_send_at, updated_at)
       VALUES ('whatsapp', ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
       last_webhook_at = COALESCE(excluded.last_webhook_at, integration_status.last_webhook_at),
       last_error = CASE WHEN ? = 1 THEN excluded.last_error ELSE integration_status.last_error END,
       last_successful_send_at = COALESCE(excluded.last_successful_send_at, integration_status.last_successful_send_at),
       updated_at = excluded.updated_at`,
      )
      .bind(
        input.lastWebhookAt ?? null,
        input.lastError ?? null,
        input.lastSuccessfulSendAt ?? null,
        timestamp,
        Object.hasOwn(input, 'lastError') ? 1 : 0,
      )
      .run();
  }

  async listConversationSummaries() {
    const result = await this.db
      .prepare(
        `SELECT c.id, c.channel, c.control_state, c.handoff_reason, c.last_customer_message_at, c.created_at,
       c.customer_service_window_expires_at, c.unread_count, cl.id AS client_id, cl.phone_e164,
       COALESCE(cl.name, cl.whatsapp_profile_name, cl.phone_e164) AS client_name, cl.lead_source,
       o.stage AS opportunity_stage, o.interest, o.summary, o.next_best_action, o.objection, o.estimated_value_cents, o.lost_reason, o.recovered_at,
       cl.preferred_professional, cl.notes AS client_notes, cl.name_source,
       (SELECT MAX(start_at) FROM appointments WHERE client_id = cl.id AND status = 'COMPLETED') AS last_attended_at,
       (SELECT professional FROM appointments WHERE client_id = cl.id AND status = 'COMPLETED' ORDER BY start_at DESC LIMIT 1) AS last_professional,
       (SELECT MAX(created_at) FROM messages WHERE conversation_id = c.id) AS last_interaction_at,
       (SELECT direction FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_direction,
       (SELECT MIN(scheduled_for) FROM follow_ups WHERE conversation_id = c.id AND status IN ('SCHEDULED','WAITING_FOR_TEMPLATE','PROCESSING')) AS pending_follow_up_at,
       (SELECT body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message,
       (SELECT status FROM messages m WHERE m.conversation_id = c.id AND m.direction = 'OUTBOUND' ORDER BY m.created_at DESC LIMIT 1) AS last_outbound_status
       FROM conversations c JOIN clients cl ON cl.id = c.client_id
       LEFT JOIN opportunities o ON o.conversation_id = c.id
       ORDER BY c.updated_at DESC LIMIT 500`,
      )
      .all();
    return result.results.map((row) => {
      const item = row as Record<string, unknown> & {
        control_state: string;
        opportunity_stage?: string | null;
      };
      return {
        ...item,
        opportunity_stage: normalizeStage(item.opportunity_stage),
        attention_priority: attentionPriority(item),
      };
    });
  }

  async listConversationMessages(conversationId: string) {
    const result = await this.db
      .prepare(
        `SELECT id, external_id, direction, sender_type, message_type, body, status, media_id, failure_reason, created_at
       FROM (
         SELECT id, external_id, direction, sender_type, message_type, body, status, media_id, failure_reason, created_at
         FROM messages WHERE conversation_id = ? ORDER BY created_at DESC, id DESC LIMIT 500
       ) ORDER BY created_at ASC, id ASC`,
      )
      .bind(conversationId)
      .all();
    return result.results;
  }

  async getIntegrationStatus() {
    return this.db
      .prepare(
        'SELECT last_webhook_at, last_error, last_successful_send_at, updated_at FROM integration_status WHERE id = ?',
      )
      .bind('whatsapp')
      .first();
  }

  async setPromotionalOptOut(conversationId: string): Promise<void> {
    await this.db
      .prepare(
        `UPDATE clients SET promotional_opt_out = 1, updated_at = ? WHERE id = (SELECT client_id FROM conversations WHERE id = ?)`,
      )
      .bind(now(), conversationId)
      .run();
    await cancelFollowUps(this.db, conversationId, 'Cliente recusou mensagens');
  }

  async recordWebhookEvent(
    externalKey: string,
    eventType: string,
    payloadHash: string,
  ): Promise<boolean> {
    const result = await this.db
      .prepare(
        `INSERT OR IGNORE INTO webhook_events (id, external_key, event_type, payload_hash, duplicate, received_at)
       VALUES (?, ?, ?, ?, 0, ?)`,
      )
      .bind(crypto.randomUUID(), externalKey, eventType, payloadHash, now())
      .run();
    if ((result.meta.changes ?? 0) === 1) return true;
    const reopened = await this.db
      .prepare(
        `UPDATE webhook_events SET processed_at = NULL, error = NULL, payload_hash = ?, received_at = ?
       WHERE external_key = ? AND error IS NOT NULL`,
      )
      .bind(payloadHash, now(), externalKey)
      .run();
    return (reopened.meta.changes ?? 0) === 1;
  }

  async completeWebhookEvent(
    externalKey: string,
    error?: string,
  ): Promise<void> {
    await this.db
      .prepare(
        `UPDATE webhook_events SET processed_at = ?, error = ? WHERE external_key = ?`,
      )
      .bind(now(), error?.slice(0, 500) ?? null, externalKey)
      .run();
  }
}
