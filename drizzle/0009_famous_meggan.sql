CREATE TABLE `web_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`host` text NOT NULL,
	`kind` text NOT NULL,
	`username` text,
	`secret` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `sources` ADD `error_kind` text;