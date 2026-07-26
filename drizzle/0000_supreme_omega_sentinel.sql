CREATE TABLE `concepts` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`priority` text DEFAULT 'medium' NOT NULL,
	`estimated_minutes` integer DEFAULT 20 NOT NULL,
	`depth_level` integer DEFAULT 1 NOT NULL,
	`topo_order` integer,
	`video_refs_json` text,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `concepts_course_idx` ON `concepts` (`course_id`);--> statement-breakpoint
CREATE TABLE `courses` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`source_prompt` text NOT NULL,
	`lang` text DEFAULT 'en' NOT NULL,
	`objective` text,
	`domain` text,
	`concreteness_rule` text,
	`start_level` text,
	`schedule_md` text,
	`glossary_md` text,
	`deadline` integer,
	`budget_minutes` integer,
	`status` text DEFAULT 'intake' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cuts` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`concept_id` text NOT NULL,
	`title` text NOT NULL,
	`reason` text NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cuts_course_idx` ON `cuts` (`course_id`);--> statement-breakpoint
CREATE TABLE `edges` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`from_concept_id` text NOT NULL,
	`to_concept_id` text NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `edges_course_idx` ON `edges` (`course_id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`run_after` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`error` text,
	`result_json` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jobs_claim_idx` ON `jobs` (`status`,`run_after`);--> statement-breakpoint
CREATE TABLE `llm_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text,
	`task` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`tokens_in` integer DEFAULT 0 NOT NULL,
	`tokens_out` integer DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`latency_ms` integer DEFAULT 0 NOT NULL,
	`ok` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `llm_calls_course_idx` ON `llm_calls` (`course_id`);--> statement-breakpoint
CREATE TABLE `modules` (
	`id` text PRIMARY KEY NOT NULL,
	`concept_id` text NOT NULL,
	`kind` text DEFAULT 'concept' NOT NULL,
	`body_md` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`eval_score` real,
	`eval_report_json` text,
	`generated_at` integer,
	FOREIGN KEY (`concept_id`) REFERENCES `concepts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `modules_concept_idx` ON `modules` (`concept_id`);--> statement-breakpoint
CREATE TABLE `questions` (
	`id` text PRIMARY KEY NOT NULL,
	`concept_id` text NOT NULL,
	`prompt` text NOT NULL,
	`expected_answer` text NOT NULL,
	`bloom_level` text NOT NULL,
	`format` text DEFAULT 'open' NOT NULL,
	`options_json` text,
	`misconceptions_json` text,
	FOREIGN KEY (`concept_id`) REFERENCES `concepts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `questions_concept_idx` ON `questions` (`concept_id`);--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`question_id` text NOT NULL,
	`answered_at` integer NOT NULL,
	`correct` integer NOT NULL,
	`confidence` text NOT NULL,
	`fsrs_state_json` text,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reviews_question_idx` ON `reviews` (`question_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`minutes` integer,
	`modules_seen_json` text,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade
);
