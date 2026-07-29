ALTER TABLE `users` ADD `is_operator` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- Existing installs already have the person who set them up: the earliest
-- examiner. Without this they would upgrade into a state with no operator at
-- all, where nobody can manage accounts.
UPDATE `users` SET `is_operator` = 1 WHERE `id` = (
  SELECT `id` FROM `users` WHERE `role` = 'examiner' ORDER BY `created_at` ASC LIMIT 1
);
