import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const clients = sqliteTable(
  'clients',
  {
    id: text('id').primaryKey(),
    phoneE164: text('phone_e164').notNull(),
    name: text('name'),
    whatsappProfileName: text('whatsapp_profile_name'),
    nameSource: text('name_source').notNull().default('WHATSAPP'),
    leadSource: text('lead_source').notNull().default('UNKNOWN'),
    leadSourceMetadata: text('lead_source_metadata'),
    preferredProfessional: text('preferred_professional'),
    notes: text('notes'),
    promotionalOptOut: integer('promotional_opt_out', { mode: 'boolean' })
      .notNull()
      .default(false),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('idx_clients_phone_e164').on(table.phoneE164)],
);

export const conversations = sqliteTable(
  'conversations',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id),
    channel: text('channel').notNull(),
    externalThreadId: text('external_thread_id'),
    controlState: text('control_state').notNull().default('AI_ACTIVE'),
    handoffReason: text('handoff_reason'),
    lastCustomerMessageAt: text('last_customer_message_at'),
    customerServiceWindowExpiresAt: text('customer_service_window_expires_at'),
    processingLockOwner: text('processing_lock_owner'),
    processingLockUntil: text('processing_lock_until'),
    unreadCount: integer('unread_count').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_conversations_client_channel').on(
      table.clientId,
      table.channel,
    ),
    index('idx_conversations_control_updated').on(
      table.controlState,
      table.updatedAt,
    ),
  ],
);

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id),
    externalId: text('external_id'),
    channel: text('channel').notNull(),
    direction: text('direction').notNull(),
    senderType: text('sender_type').notNull(),
    messageType: text('message_type').notNull(),
    body: text('body'),
    mediaId: text('media_id'),
    status: text('status').notNull().default('queued'),
    processingState: text('processing_state').notNull().default('RECEIVED'),
    processingAttempts: integer('processing_attempts').notNull().default(0),
    nextProcessingAt: text('next_processing_at'),
    processingError: text('processing_error'),
    replyToMessageId: text('reply_to_message_id'),
    metadataJson: text('metadata_json'),
    referralJson: text('referral_json'),
    sentAt: text('sent_at'),
    deliveredAt: text('delivered_at'),
    readAt: text('read_at'),
    failedAt: text('failed_at'),
    failureReason: text('failure_reason'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_messages_external_id').on(table.externalId),
    index('idx_messages_conversation_created').on(
      table.conversationId,
      table.createdAt,
    ),
    index('idx_messages_pending_inbound').on(
      table.conversationId,
      table.processingState,
    ),
    index('idx_messages_processing_due').on(
      table.processingState,
      table.nextProcessingAt,
    ),
    uniqueIndex('idx_messages_reply_to')
      .on(table.replyToMessageId)
      .where(sql`${table.replyToMessageId} IS NOT NULL`),
  ],
);

export const webhookEvents = sqliteTable(
  'webhook_events',
  {
    id: text('id').primaryKey(),
    externalKey: text('external_key').notNull(),
    eventType: text('event_type').notNull(),
    payloadHash: text('payload_hash').notNull(),
    duplicate: integer('duplicate', { mode: 'boolean' })
      .notNull()
      .default(false),
    receivedAt: text('received_at').notNull(),
    processedAt: text('processed_at'),
    error: text('error'),
  },
  (table) => [
    uniqueIndex('idx_webhook_events_external_key').on(table.externalKey),
  ],
);

export const handoffs = sqliteTable(
  'handoffs',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id),
    triggerMessageId: text('trigger_message_id').references(() => messages.id),
    reason: text('reason').notNull(),
    status: text('status').notNull().default('OPEN'),
    createdAt: text('created_at').notNull(),
    resolvedAt: text('resolved_at'),
  },
  (table) => [
    index('idx_handoffs_open').on(table.status, table.createdAt),
    uniqueIndex('idx_handoffs_one_open_per_conversation')
      .on(table.conversationId)
      .where(sql`${table.status} = 'OPEN'`),
  ],
);

export const opportunities = sqliteTable(
  'opportunities',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id),
    title: text('title').notNull(),
    stage: text('stage').notNull().default('NEW'),
    estimatedValueCents: integer('estimated_value_cents'),
    interest: text('interest'),
    summary: text('summary'),
    nextBestAction: text('next_best_action')
      .notNull()
      .default('ANSWER_QUESTION'),
    objection: text('objection'),
    intent: text('intent'),
    lastInteractionAt: text('last_interaction_at'),
    lostReason: text('lost_reason'),
    recoveredAt: text('recovered_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_opportunities_conversation').on(table.conversationId),
  ],
);

export const followUps = sqliteTable(
  'follow_ups',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id),
    channel: text('channel').notNull(),
    scheduledFor: text('scheduled_for').notNull(),
    triggerMessageId: text('trigger_message_id'),
    priority: integer('priority').notNull().default(50),
    reason: text('reason'),
    recoveredAt: text('recovered_at'),
    status: text('status').notNull().default('SCHEDULED'),
    deliveryEligibility: text('delivery_eligibility').notNull(),
    templateRequired: integer('template_required', { mode: 'boolean' })
      .notNull()
      .default(false),
    templateName: text('template_name'),
    messageBody: text('message_body'),
    sentAt: text('sent_at'),
    lastError: text('last_error'),
    attemptCount: integer('attempt_count').notNull().default(0),
    nextAttemptAt: text('next_attempt_at'),
    lockedAt: text('locked_at'),
    outboundMessageId: text('outbound_message_id').references(
      () => messages.id,
    ),
    sequenceNumber: integer('sequence_number').notNull().default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('idx_followups_due').on(table.status, table.scheduledFor)],
);

export const appointments = sqliteTable(
  'appointments',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id').references(() => conversations.id),
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id),
    professional: text('professional').notNull(),
    service: text('service').notNull(),
    startAt: text('start_at').notNull(),
    durationMinutes: integer('duration_minutes').notNull().default(60),
    status: text('status').notNull().default('PENDING_CONFIRMATION'),
    notes: text('notes'),
    sourceMessageId: text('source_message_id'),
    estimatedValueCents: integer('estimated_value_cents'),
    confirmationMessageId: text('confirmation_message_id').references(
      () => messages.id,
    ),
    confirmationSentAt: text('confirmation_sent_at'),
    confirmationError: text('confirmation_error'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_appointments_start_status').on(table.startAt, table.status),
    uniqueIndex('idx_appointments_source_message').on(table.sourceMessageId),
  ],
);

export const whatsappTemplates = sqliteTable(
  'whatsapp_templates',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    language: text('language').notNull(),
    category: text('category').notNull(),
    approved: integer('approved', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_templates_name_language').on(table.name, table.language),
  ],
);

export const auditEvents = sqliteTable(
  'audit_events',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id').references(() => conversations.id),
    eventType: text('event_type').notNull(),
    actorType: text('actor_type').notNull(),
    metadataJson: text('metadata_json'),
    dedupKey: text('dedup_key'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_audit_conversation_created').on(
      table.conversationId,
      table.createdAt,
    ),
    uniqueIndex('idx_audit_dedup').on(table.dedupKey),
  ],
);

export const integrationStatus = sqliteTable('integration_status', {
  id: text('id').primaryKey(),
  lastWebhookAt: text('last_webhook_at'),
  lastError: text('last_error'),
  lastSuccessfulSendAt: text('last_successful_send_at'),
  updatedAt: text('updated_at').notNull(),
});

export const authLoginAttempts = sqliteTable('auth_login_attempts', {
  clientKey: text('client_key').primaryKey(),
  failedAttempts: integer('failed_attempts').notNull().default(0),
  firstFailedAt: text('first_failed_at').notNull(),
  blockedUntil: text('blocked_until'),
  updatedAt: text('updated_at').notNull(),
});
