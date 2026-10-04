# Coverage map

What is checked, by what, and what is not. "Law" means a test or script in this
repository that fails when the behaviour breaks; each one below was run against
the broken behaviour before it was trusted.

| Area | Question | Checked by | State |
|---|---|---|---|
| Dependencies | Known advisories in production deps? | `pnpm audit:deps` (CI, every push and weekly) | covered |
| API routes | Who may call what? | `tests/entrypoints.test.ts` (inventory), `e2e/9-access.spec.ts` (black-box probe) | covered |
| Sign-in | Can timing reveal which emails have an account? | `tests/auth-sessions.test.ts` | covered |
| Sign-in vs reset | Can a sign-in that started before a password reset create a session after it? | `tests/auth-sessions.test.ts` | covered |
| Password reset | Do existing sessions survive it? | `tests/auth-sessions.test.ts` | covered |
| Sign-in load | Can varying the email bypass the throttle and exhaust memory? | `tests/hash-gate.test.ts`, `tests/throttle.test.ts` | covered |
| Registration | Does "account already exists" enumerate emails? | `tests/register-enumeration.test.ts` | covered |
| URL fetching | Can IPv6 spellings of private IPv4 reach internal hosts? | `tests/url.test.ts` | guard covered; not proven end to end (no IPv6 in the test environment) |
| Upgrades | Does every published release migrate with its data intact, to the same schema as a fresh install? | `pnpm check:upgrade` (CI on pull requests and weekly) | covered, 6 releases |
| Platforms | Does it build, start and stay up on Windows, macOS, Linux, Node 22 and 24? | CI `runtime` matrix | covered |
| Backup | Is a copy taken, consistent, and read back? | `tests/backup.test.ts` | covered |
| Restore | Does a backup taken while the app is writing restore to something the app can read, with the user able to sign in? | `tests/restore.test.ts` (separate processes, the operator's commands) | covered; not with a production-sized database |
| Restore procedure | Does leaving the old `-wal` in place break a restore? | `tests/restore.test.ts`, DEPLOY.md | covered |
| Document import | Can a small docx or pdf exhaust memory or time? | `tests/inflate-guard.test.ts` | covered for docx and pdf; four real pdfs pass the guard |
| Document import | Other hostile content (malformed pdf structure, polyglots)? | none | not checked |
| State-changing GET routes | Cross-site request with the session cookie? | read of every GET handler | one GET writes an export log row; accepted |
| Concurrency | Two processes on one database? | `tests/concurrency.test.ts`, `e2e/96-two-students.spec.ts` | partial: one process |
| Export | Output validated against a format schema? | `tests/export-privacy.test.ts` | partial: privacy only |
| Interface | Phone layout, no sideways scroll | `e2e/8-mobile.spec.ts` | partial: Chromium only |
| Fuzzing, hostile uploads | | none | not checked |
| Query count vs data size | | none | not checked |

Baseline at the time of writing: 969 unit tests in about 27 s, 63 end-to-end
tests in about 7.5 min, install 11 s, build 2 min 17 s.
