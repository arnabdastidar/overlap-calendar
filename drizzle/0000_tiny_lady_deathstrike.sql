CREATE TABLE `calendar_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`participant_id` text NOT NULL,
	`provider` text NOT NULL,
	`account_ref` text NOT NULL,
	`display_name` text NOT NULL,
	`encrypted_refresh_token` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_connections_participant_provider` ON `calendar_connections` (`participant_id`,`provider`);--> statement-breakpoint
CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`slug` text NOT NULL,
	`password_hash` text NOT NULL,
	`password_salt` text NOT NULL,
	`admin_token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_groups_name_key` ON `groups` (`name_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_groups_slug` ON `groups` (`slug`);--> statement-breakpoint
CREATE TABLE `oauth_states` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`provider` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `participants` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`display_name` text NOT NULL,
	`color` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`role` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE cascade
);
