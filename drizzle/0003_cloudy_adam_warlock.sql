CREATE TABLE `source_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`course_id` text NOT NULL,
	`ord` integer DEFAULT 0 NOT NULL,
	`text` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `source_chunks_course_idx` ON `source_chunks` (`course_id`);--> statement-breakpoint
CREATE INDEX `source_chunks_source_idx` ON `source_chunks` (`source_id`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`kind` text DEFAULT 'file' NOT NULL,
	`name` text NOT NULL,
	`mime` text,
	`bytes` integer DEFAULT 0 NOT NULL,
	`text_len` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'ok' NOT NULL,
	`error` text,
	`sensitivity_json` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sources_course_idx` ON `sources` (`course_id`);