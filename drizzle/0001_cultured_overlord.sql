CREATE TABLE `appointments` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text,
	`client_id` text NOT NULL,
	`professional` text NOT NULL,
	`service` text NOT NULL,
	`start_at` text NOT NULL,
	`duration_minutes` integer DEFAULT 60 NOT NULL,
	`status` text DEFAULT 'PENDING_CONFIRMATION' NOT NULL,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_appointments_start_status` ON `appointments` (`start_at`,`status`);--> statement-breakpoint
ALTER TABLE `follow_ups` ADD `message_body` text;--> statement-breakpoint
ALTER TABLE `follow_ups` ADD `sent_at` text;--> statement-breakpoint
ALTER TABLE `follow_ups` ADD `last_error` text;