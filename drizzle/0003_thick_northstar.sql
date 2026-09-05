ALTER TABLE `appointments` ADD `source_message_id` text;--> statement-breakpoint
ALTER TABLE `appointments` ADD `estimated_value_cents` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_appointments_source_message` ON `appointments` (`source_message_id`);--> statement-breakpoint
ALTER TABLE `audit_events` ADD `dedup_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_audit_dedup` ON `audit_events` (`dedup_key`);--> statement-breakpoint
ALTER TABLE `clients` ADD `preferred_professional` text;--> statement-breakpoint
ALTER TABLE `clients` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `follow_ups` ADD `trigger_message_id` text;--> statement-breakpoint
ALTER TABLE `follow_ups` ADD `priority` integer DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE `follow_ups` ADD `reason` text;--> statement-breakpoint
ALTER TABLE `follow_ups` ADD `recovered_at` text;--> statement-breakpoint
ALTER TABLE `opportunities` ADD `next_best_action` text DEFAULT 'ANSWER_QUESTION' NOT NULL;--> statement-breakpoint
ALTER TABLE `opportunities` ADD `objection` text;--> statement-breakpoint
ALTER TABLE `opportunities` ADD `intent` text;--> statement-breakpoint
ALTER TABLE `opportunities` ADD `last_interaction_at` text;--> statement-breakpoint
ALTER TABLE `opportunities` ADD `lost_reason` text;--> statement-breakpoint
ALTER TABLE `opportunities` ADD `recovered_at` text;