CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`type` text NOT NULL,
	`settings` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_username` ON `accounts` (`username`);--> statement-breakpoint
CREATE TABLE `active_operations` (
	`user_id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`kind` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `events` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_id` ON `events` (`id`);--> statement-breakpoint
CREATE INDEX `events_user_sequence` ON `events` (`user_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `events_session` ON `events` (`session_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `account_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `account_sessions_user` ON `account_sessions` (`user_id`);