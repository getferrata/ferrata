-- Invites become account invites: they carry the role, expire, and burn on use.
-- Links issued before this migration had no expiry at all, so they are given 72
-- hours from the upgrade: anyone mid-onboarding still gets in, and the
-- never-expiring property is gone.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text,
	`role` text DEFAULT 'student' NOT NULL,
	`created_by` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`used_by` text,
	`revoked_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_invites`("id", "course_id", "role", "created_by", "expires_at", "created_at") SELECT "id", "course_id", 'student', "created_by", (unixepoch() * 1000) + 259200000, "created_at" FROM `invites`;--> statement-breakpoint
DROP TABLE `invites`;--> statement-breakpoint
ALTER TABLE `__new_invites` RENAME TO `invites`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `invites_course_idx` ON `invites` (`course_id`);--> statement-breakpoint
ALTER TABLE `llm_calls` ADD `user_id` text;--> statement-breakpoint
ALTER TABLE `llm_calls` ADD `credits` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `llm_calls_user_idx` ON `llm_calls` (`user_id`,`created_at`);