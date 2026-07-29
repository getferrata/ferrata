ALTER TABLE `questions` ADD `blanks_json` text;--> statement-breakpoint
ALTER TABLE `reviews` ADD `graded_by` text DEFAULT 'self' NOT NULL;