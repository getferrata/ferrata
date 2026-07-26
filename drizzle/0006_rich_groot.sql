CREATE TABLE `restorations` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`token` text NOT NULL,
	`value` text NOT NULL,
	`label` text NOT NULL,
	`type` text NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `restorations_course_idx` ON `restorations` (`course_id`);