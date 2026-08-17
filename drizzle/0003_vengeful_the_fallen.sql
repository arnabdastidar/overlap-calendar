CREATE TABLE `verification_rate_limits` (
	`scope_key` text NOT NULL,
	`window_start` integer NOT NULL,
	`request_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_verification_rate_scope_window` ON `verification_rate_limits` (`scope_key`,`window_start`);