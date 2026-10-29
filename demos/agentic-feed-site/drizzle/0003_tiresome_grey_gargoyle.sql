CREATE TABLE `source_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text NOT NULL,
	`source` text NOT NULL,
	`query` text NOT NULL,
	`expires_at` integer NOT NULL,
	`result` text,
	FOREIGN KEY (`user_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `source_jobs_user` ON `source_jobs` (`user_id`,`expires_at`);