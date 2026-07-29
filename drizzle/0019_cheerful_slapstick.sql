ALTER TABLE `concepts` ADD `retired_at` integer;--> statement-breakpoint
ALTER TABLE `questions` ADD `retired_at` integer;--> statement-breakpoint
ALTER TABLE `reviews` ADD `question_prompt` text;