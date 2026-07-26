CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `invites_course_idx` ON `invites` (`course_id`);--> statement-breakpoint
ALTER TABLE `courses` ADD `depth_preset` text DEFAULT 'operational' NOT NULL;--> statement-breakpoint
ALTER TABLE `enrollments` ADD `deadline` integer;