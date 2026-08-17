CREATE TABLE `email_verifications` (
	`challenge_hash` text PRIMARY KEY NOT NULL,
	`group_id` text,
	`participant_id` text,
	`email_key` text NOT NULL,
	`purpose` text NOT NULL,
	`code_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_email_verifications_email_created` ON `email_verifications` (`email_key`,`created_at`);--> statement-breakpoint
ALTER TABLE `participants` ADD `email` text;--> statement-breakpoint
ALTER TABLE `participants` ADD `email_key` text;--> statement-breakpoint
ALTER TABLE `participants` ADD `email_verified_at` integer;--> statement-breakpoint
ALTER TABLE `participants` ADD `is_creator` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_participants_group_email` ON `participants` (`group_id`,`email_key`) WHERE "participants"."email_key" IS NOT NULL;