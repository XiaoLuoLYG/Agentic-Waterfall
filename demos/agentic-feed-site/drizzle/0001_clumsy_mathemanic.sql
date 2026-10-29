CREATE TABLE `progress` (
	`session_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`payload` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `accounts` ADD `display_name` text;