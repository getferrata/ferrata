CREATE TABLE `explanations` (
	`id` text PRIMARY KEY NOT NULL,
	`concept_id` text NOT NULL,
	`user_id` text,
	`complete` integer NOT NULL,
	`gap` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`concept_id`) REFERENCES `concepts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `explanations_concept_idx` ON `explanations` (`concept_id`);--> statement-breakpoint
CREATE INDEX `explanations_user_idx` ON `explanations` (`user_id`);