import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, real, index } from "drizzle-orm/sqlite-core";

/**
 * Schema of record for Ferrata: the core course/module/question model plus
 * course-level schedule + glossary, module `kind`, course `lang`, and a
 * per-concept video annex.
 *
 * Conventions:
 *  - Text ids (crypto.randomUUID) generated in app code, not by the DB.
 *  - Timestamps are unix epoch milliseconds stored as integer.
 *  - JSON columns are suffixed `_json` and hold validated, serialized shapes.
 */

// --- enums (as TS-narrowed text columns) ------------------------------------

export type Priority = "critical" | "high" | "medium" | "low";
export type CourseOrigin = "local" | "imported";
export type CourseStatus =
  | "interviewing" // generating the authoring interview questions
  | "interview" // questions ready, awaiting the author's answers (human step)
  | "intake"
  | "concept_review" // concepts extracted, awaiting the author's keep/drop (human step)
  | "graphing"
  | "triaging"
  | "generating"
  | "ready"
  | "failed";
export type ModuleKind = "concept" | "method" | "meta";
export type ModuleStatus = "pending" | "generating" | "ready" | "rejected";
export type BloomLevel =
  | "remember"
  | "understand"
  | "apply"
  | "analyze"
  | "evaluate"
  | "create";
export type QuestionFormat = "open" | "mcq" | "cloze" | "explain";
export type Confidence = "low" | "medium" | "high";
export type JobStatus = "queued" | "running" | "done" | "failed";
// Onboarding roles (two-role split): the examiner/author owns and
// assigns courses and sees progress; the student studies and is measured.
export type UserRole = "student" | "examiner";
// How deep the explanations go, chosen at creation. Named presets, not a raw
// number, because depth can't be calibrated precisely.
export type DepthPreset = "overview" | "operational" | "scratch";

// --- courses ----------------------------------------------------------------

export const courses = sqliteTable("courses", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  sourcePrompt: text("source_prompt").notNull(),
  // The author's context: interview answers + tacit knowledge.
  authorContextMd: text("author_context_md"),
  // The authoring interview: { questions: [{key,question,why}], answers: {key:text} }.
  interviewJson: text("interview_json"),
  // Where this course came from: locally generated vs imported from a package.
  // Imported content is untrusted until re-verified.
  origin: text("origin").$type<CourseOrigin>().notNull().default("local"),
  lang: text("lang").notNull().default("en"),
  // Honest, reframed objective ("the real objective is…").
  objective: text("objective"),
  domain: text("domain"),
  // The concreteness compact stated to the reader, per-domain.
  concretenessRule: text("concreteness_rule"),
  startLevel: text("start_level"),
  // Rendered course-level artifacts: the study schedule and the flash glossary.
  scheduleMd: text("schedule_md"),
  glossaryMd: text("glossary_md"),
  deadline: integer("deadline"),
  budgetMinutes: integer("budget_minutes"),
  status: text("status").$type<CourseStatus>().notNull().default("intake"),
  // The examiner/author who owns this course. Null for seed/legacy courses,
  // which remain visible to everyone (a fresh install has no owner yet).
  ownerId: text("owner_id"),
  // How deep explanations go (biases intake + write_module). Operational is
  // the default.
  depthPreset: text("depth_preset")
    .$type<DepthPreset>()
    .notNull()
    .default("operational"),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

// --- users, auth sessions, enrollments (onboarding multi-user) --------------

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    // scrypt: stored as "salt:derivedKey" hex (see lib/auth/password).
    passwordHash: text("password_hash").notNull(),
    role: text("role").$type<UserRole>().notNull().default("student"),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("users_email_idx").on(t.email)],
);

export const authSessions = sqliteTable(
  "auth_sessions",
  {
    // sha-256 of the opaque cookie token; the raw token is never stored.
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("auth_sessions_user_idx").on(t.userId)],
);

// A student assigned to a course by an examiner (the onboarding roster).
export const enrollments = sqliteTable(
  "enrollments",
  {
    id: text("id").primaryKey(),
    courseId: text("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Per-student deadline (SPEC): "finish by", relative to when THIS student
    // started, not a course-wide absolute date. Null = no deadline.
    deadline: integer("deadline"),
    // Resume bookmark: the last module this student opened, and when. Lets the
    // course pick up where they left off. Null until they open one.
    lastModuleId: text("last_module_id"),
    lastSeenAt: integer("last_seen_at"),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    index("enrollments_course_idx").on(t.courseId),
    index("enrollments_user_idx").on(t.userId),
  ],
);

// Reversible Contextia redactions: an operational value (IP, internal hostname)
// hidden from the model as a token, but restored into the finished course for the
// student, marked as Contextia-protected. Critical secrets are NOT stored here.
// They are redacted irreversibly and never reappear.
export const restorations = sqliteTable(
  "restorations",
  {
    id: text("id").primaryKey(),
    courseId: text("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    token: text("token").notNull(), // ⟨cxt:hash⟩ placeholder seen by the model
    value: text("value").notNull(), // the real value, restored at render time
    label: text("label").notNull(), // e.g. "Private IP address"
    type: text("type").notNull(), // detector id
  },
  (t) => [index("restorations_course_idx").on(t.courseId)],
);

// A shareable invite link to a course. Opening it and authenticating enrolls
// the user. No email needed. The examiner shares the link however they like.
// An invite is the only way in once the first account exists. It decides the
// role, so nobody picks their own, and it burns on use so a forwarded link is
// worth nothing to the second person who opens it.
export const invites = sqliteTable(
  "invites",
  {
    // The opaque token in the URL (/invito/<token>).
    id: text("id").primaryKey(),
    // Null for an account invite ("come in as an author"); set when the invite
    // also enrolls the new account in a course.
    courseId: text("course_id").references(() => courses.id, {
      onDelete: "cascade",
    }),
    role: text("role").$type<UserRole>().notNull().default("student"),
    createdBy: text("created_by").notNull(),
    expiresAt: integer("expires_at").notNull(),
    usedAt: integer("used_at"),
    usedBy: text("used_by"),
    revokedAt: integer("revoked_at"),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("invites_course_idx").on(t.courseId)],
);

// --- packages (the portable course artifact) --------------------------------

export const packages = sqliteTable(
  "packages",
  {
    id: text("id").primaryKey(),
    courseId: text("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    // Serialized manifest.json: title, author, lang, version, license, source_hash.
    manifestJson: text("manifest_json").notNull(),
    exportedAt: integer("exported_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    // Hash of the source material, so a re-import can detect drift.
    sourceHash: text("source_hash"),
    // Self-generated packages are trusted; imported ones are not until verified.
    trusted: integer("trusted", { mode: "boolean" }).notNull().default(true),
  },
  (t) => [index("packages_course_idx").on(t.courseId)],
);

// --- sources (author material to ground generation on) ----------------------

export type SourceKind = "text" | "file" | "url";
export type SourceStatus = "ok" | "failed";

export const sources = sqliteTable(
  "sources",
  {
    id: text("id").primaryKey(),
    courseId: text("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    kind: text("kind").$type<SourceKind>().notNull().default("file"),
    name: text("name").notNull(),
    mime: text("mime"),
    bytes: integer("bytes").notNull().default(0),
    textLen: integer("text_len").notNull().default(0),
    status: text("status").$type<SourceStatus>().notNull().default("ok"),
    error: text("error"),
    // Failure class for the UI: auth, bot, unreachable, private, empty, http.
    errorKind: text("error_kind"),
    // Contextia (DLP) verdict recorded at ingestion; null until the gate is wired.
    sensitivityJson: text("sensitivity_json"),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("sources_course_idx").on(t.courseId)],
);

export const sourceChunks = sqliteTable(
  "source_chunks",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    courseId: text("course_id").notNull(),
    ord: integer("ord").notNull().default(0),
    text: text("text").notNull(),
  },
  (t) => [
    index("source_chunks_course_idx").on(t.courseId),
    index("source_chunks_source_idx").on(t.sourceId),
  ],
);

// --- concepts + edges (the prerequisite DAG) --------------------------------

export const concepts = sqliteTable(
  "concepts",
  {
    id: text("id").primaryKey(),
    courseId: text("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    priority: text("priority").$type<Priority>().notNull().default("medium"),
    estimatedMinutes: integer("estimated_minutes").notNull().default(20),
    depthLevel: integer("depth_level").notNull().default(1), // 0=for dummies … 3=operativo
    // Topological rank filled once the DAG is ordered (null until then).
    topoOrder: integer("topo_order"),
    // Per-concept video annex (decision A): [{ url, title, query }].
    videoRefsJson: text("video_refs_json"),
  },
  (t) => [index("concepts_course_idx").on(t.courseId)],
);

export const edges = sqliteTable(
  "edges",
  {
    id: text("id").primaryKey(),
    courseId: text("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    // prerequisite: `from` must be learned before `to`.
    fromConceptId: text("from_concept_id").notNull(),
    toConceptId: text("to_concept_id").notNull(),
  },
  (t) => [index("edges_course_idx").on(t.courseId)],
);

// --- modules ----------------------------------------------------------------

export const modules = sqliteTable(
  "modules",
  {
    id: text("id").primaryKey(),
    conceptId: text("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    kind: text("kind").$type<ModuleKind>().notNull().default("concept"),
    bodyMd: text("body_md"),
    status: text("status").$type<ModuleStatus>().notNull().default("pending"),
    // Aggregate eval score (0..1) from the quality harness.
    evalScore: real("eval_score"),
    evalReportJson: text("eval_report_json"),
    generatedAt: integer("generated_at"),
  },
  (t) => [index("modules_concept_idx").on(t.conceptId)],
);

// --- questions --------------------------------------------------------------

export const questions = sqliteTable(
  "questions",
  {
    id: text("id").primaryKey(),
    conceptId: text("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    prompt: text("prompt").notNull(),
    expectedAnswer: text("expected_answer").notNull(),
    bloomLevel: text("bloom_level").$type<BloomLevel>().notNull(),
    format: text("format").$type<QuestionFormat>().notNull().default("open"),
    // For mcq: serialized { options: string[], correctIndex: number }.
    optionsJson: text("options_json"),
    misconceptionsJson: text("misconceptions_json"),
  },
  (t) => [index("questions_concept_idx").on(t.conceptId)],
);

// --- reviews (FSRS card history) --------------------------------------------

export const reviews = sqliteTable(
  "reviews",
  {
    id: text("id").primaryKey(),
    questionId: text("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    answeredAt: integer("answered_at").notNull(),
    correct: integer("correct", { mode: "boolean" }).notNull(),
    confidence: text("confidence").$type<Confidence>().notNull(),
    // Which student answered (null for legacy/anonymous single-user reviews).
    userId: text("user_id"),
    // FSRS per-card state: { stability, difficulty, due, reps, lapses }.
    fsrsStateJson: text("fsrs_state_json"),
  },
  (t) => [
    index("reviews_question_idx").on(t.questionId),
    index("reviews_user_idx").on(t.userId),
  ],
);

// --- explanations (Feynman explain-back attempts) ---------------------------

export const explanations = sqliteTable(
  "explanations",
  {
    id: text("id").primaryKey(),
    conceptId: text("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    userId: text("user_id"),
    // Verdict of the explain-back check: did the explanation hold up?
    complete: integer("complete", { mode: "boolean" }).notNull(),
    gap: text("gap").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("explanations_concept_idx").on(t.conceptId),
    index("explanations_user_idx").on(t.userId),
  ],
);

// --- study sessions ---------------------------------------------------------

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  courseId: text("course_id")
    .notNull()
    .references(() => courses.id, { onDelete: "cascade" }),
  startedAt: integer("started_at").notNull(),
  endedAt: integer("ended_at"),
  minutes: integer("minutes"),
  modulesSeenJson: text("modules_seen_json"),
});

// --- triage cuts ------------------------------------------------------------

export const cuts = sqliteTable(
  "cuts",
  {
    id: text("id").primaryKey(),
    courseId: text("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    conceptId: text("concept_id").notNull(),
    title: text("title").notNull(),
    reason: text("reason").notNull(),
  },
  (t) => [index("cuts_course_idx").on(t.courseId)],
);

// --- jobs (in-process queue) ------------------------------------------------

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    payloadJson: text("payload_json").notNull(),
    status: text("status").$type<JobStatus>().notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    // Poll gate: worker only claims jobs whose runAfter <= now.
    runAfter: integer("run_after")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    error: text("error"),
    resultJson: text("result_json"),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("jobs_claim_idx").on(t.status, t.runAfter)],
);

// --- llm_calls (cost/latency ledger) ----------------------------------------

export const llmCalls = sqliteTable(
  "llm_calls",
  {
    id: text("id").primaryKey(),
    courseId: text("course_id"),
    // Who this spend belongs to. Null on a call made outside any session
    // (a seed script, or an install that predates attribution).
    userId: text("user_id"),
    task: text("task").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    costUsd: real("cost_usd").notNull().default(0),
    // costUsd in whole US cents, which is what a credit is. Integer so a
    // balance never drifts the way a running sum of floats does.
    credits: integer("credits").notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    ok: integer("ok", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    index("llm_calls_course_idx").on(t.courseId),
    index("llm_calls_user_idx").on(t.userId, t.createdAt),
  ],
);

// --- web credentials (per-host auth for linked KB sources) ------------------
// Lets a pasted wiki link behind sign-in work: the operator stores a token for
// that host and the URL fetcher attaches it automatically. Secrets stay local.

export const webCredentials = sqliteTable("web_credentials", {
  id: text("id").primaryKey(),
  // Hostname the credential applies to, e.g. "wiki.acme.com". Exact match or
  // any subdomain of it.
  host: text("host").notNull(),
  kind: text("kind").$type<"basic" | "bearer">().notNull(),
  // For basic auth (e.g. Confluence: account email + API token).
  username: text("username"),
  secret: text("secret").notNull(),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

// --- app settings (key/value, e.g. LLM provider + API key) ------------------
// Lives in the local DB, same trust boundary as .env.local. Values are read at
// boot and applied over the process env; the settings UI writes here.

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

// --- inferred types ---------------------------------------------------------

export type Course = typeof courses.$inferSelect;
export type NewCourse = typeof courses.$inferInsert;
export type Package = typeof packages.$inferSelect;
export type Source = typeof sources.$inferSelect;
export type SourceChunk = typeof sourceChunks.$inferSelect;
export type Concept = typeof concepts.$inferSelect;
export type Edge = typeof edges.$inferSelect;
export type Module = typeof modules.$inferSelect;
export type Question = typeof questions.$inferSelect;
export type Review = typeof reviews.$inferSelect;
export type Cut = typeof cuts.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type LlmCall = typeof llmCalls.$inferSelect;
