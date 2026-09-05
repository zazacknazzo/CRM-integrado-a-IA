CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text,
	`event_type` text NOT NULL,
	`actor_type` text NOT NULL,
	`metadata_json` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_audit_conversation_created` ON `audit_events` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `clients` (
	`id` text PRIMARY KEY NOT NULL,
	`phone_e164` text NOT NULL,
	`name` text,
	`whatsapp_profile_name` text,
	`name_source` text DEFAULT 'WHATSAPP' NOT NULL,
	`lead_source` text DEFAULT 'UNKNOWN' NOT NULL,
	`lead_source_metadata` text,
	`promotional_opt_out` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_clients_phone_e164` ON `clients` (`phone_e164`);--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`channel` text NOT NULL,
	`external_thread_id` text,
	`control_state` text DEFAULT 'AI_ACTIVE' NOT NULL,
	`handoff_reason` text,
	`last_customer_message_at` text,
	`customer_service_window_expires_at` text,
	`processing_lock_owner` text,
	`processing_lock_until` text,
	`unread_count` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_conversations_client_channel` ON `conversations` (`client_id`,`channel`);--> statement-breakpoint
CREATE INDEX `idx_conversations_control_updated` ON `conversations` (`control_state`,`updated_at`);--> statement-breakpoint
CREATE TABLE `follow_ups` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`channel` text NOT NULL,
	`scheduled_for` text NOT NULL,
	`status` text DEFAULT 'SCHEDULED' NOT NULL,
	`delivery_eligibility` text NOT NULL,
	`template_required` integer DEFAULT false NOT NULL,
	`template_name` text,
	`sequence_number` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_followups_due` ON `follow_ups` (`status`,`scheduled_for`);--> statement-breakpoint
CREATE TABLE `handoffs` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`trigger_message_id` text,
	`reason` text NOT NULL,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`created_at` text NOT NULL,
	`resolved_at` text,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`trigger_message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_handoffs_open` ON `handoffs` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `integration_status` (
	`id` text PRIMARY KEY NOT NULL,
	`last_webhook_at` text,
	`last_error` text,
	`last_successful_send_at` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`external_id` text,
	`channel` text NOT NULL,
	`direction` text NOT NULL,
	`sender_type` text NOT NULL,
	`message_type` text NOT NULL,
	`body` text,
	`media_id` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`processing_state` text DEFAULT 'RECEIVED' NOT NULL,
	`metadata_json` text,
	`referral_json` text,
	`sent_at` text,
	`delivered_at` text,
	`read_at` text,
	`failed_at` text,
	`failure_reason` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_messages_external_id` ON `messages` (`external_id`);--> statement-breakpoint
CREATE INDEX `idx_messages_conversation_created` ON `messages` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_messages_pending_inbound` ON `messages` (`conversation_id`,`processing_state`);--> statement-breakpoint
CREATE TABLE `opportunities` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`title` text NOT NULL,
	`stage` text DEFAULT 'NEW' NOT NULL,
	`estimated_value_cents` integer,
	`interest` text,
	`summary` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_opportunities_conversation` ON `opportunities` (`conversation_id`);--> statement-breakpoint
CREATE TABLE `webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`external_key` text NOT NULL,
	`event_type` text NOT NULL,
	`payload_hash` text NOT NULL,
	`duplicate` integer DEFAULT false NOT NULL,
	`received_at` text NOT NULL,
	`processed_at` text,
	`error` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_webhook_events_external_key` ON `webhook_events` (`external_key`);--> statement-breakpoint
CREATE TABLE `whatsapp_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`language` text NOT NULL,
	`category` text NOT NULL,
	`approved` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_templates_name_language` ON `whatsapp_templates` (`name`,`language`);
--> statement-breakpoint
PRAGMA optimize;
