CREATE TABLE `packages` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`manifest_json` text NOT NULL,
	`exported_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`source_hash` text,
	`trusted` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `packages_course_idx` ON `packages` (`course_id`);--> statement-breakpoint
ALTER TABLE `courses` ADD `author_context_md` text;--> statement-breakpoint
ALTER TABLE `courses` ADD `origin` text DEFAULT 'local' NOT NULL;