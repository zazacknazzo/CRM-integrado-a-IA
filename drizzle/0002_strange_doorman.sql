CREATE TABLE `auth_login_attempts` (
	`client_key` text PRIMARY KEY NOT NULL,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`first_failed_at` text NOT NULL,
	`blocked_until` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `appointments` ADD `confirmation_message_id` text REFERENCES messages(id);--> statement-breakpoint
ALTER TABLE `appointments` ADD `confirmation_sent_at` text;--> statement-breakpoint
ALTER TABLE `appointments` ADD `confirmation_error` text;--> statement-breakpoint
ALTER TABLE `follow_ups` ADD `attempt_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `follow_ups` ADD `next_attempt_at` text;--> statement-breakpoint
ALTER TABLE `follow_ups` ADD `locked_at` text;--> statement-breakpoint
ALTER TABLE `follow_ups` ADD `outbound_message_id` text REFERENCES messages(id);--> statement-breakpoint
ALTER TABLE `messages` ADD `processing_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `next_processing_at` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `processing_error` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `reply_to_message_id` text;--> statement-breakpoint
CREATE INDEX `idx_messages_processing_due` ON `messages` (`processing_state`,`next_processing_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_messages_reply_to` ON `messages` (`reply_to_message_id`) WHERE "messages"."reply_to_message_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_handoffs_one_open_per_conversation` ON `handoffs` (`conversation_id`) WHERE "handoffs"."status" = 'OPEN';