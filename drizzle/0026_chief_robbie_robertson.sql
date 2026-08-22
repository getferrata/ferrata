CREATE TABLE `figures` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`source_id` text NOT NULL,
	`sha256` text NOT NULL,
	`mime` text NOT NULL,
	`bytes` integer NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`alt_text` text,
	`ord` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`decided_at` integer,
	`decided_by` text,
	`data` blob NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `figures_course_idx` ON `figures` (`course_id`);--> statement-breakpoint
CREATE INDEX `figures_source_idx` ON `figures` (`source_id`);