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
| Backup / restore | Does a restored backup match the original? | `tests/backup.test.ts` | partial: not exercised with a production-sized database |
| Document import | Hostile documents? | `tests/figures.test.ts` | partial: docx only |
| Concurrency | Two processes on one database? | `tests/concurrency.test.ts`, `e2e/96-two-students.spec.ts` | partial: one process |
| Export | Output validated against a format schema? | `tests/export-privacy.test.ts` | partial: privacy only |
| Interface | Phone layout, no sideways scroll | `e2e/8-mobile.spec.ts` | partial: Chromium only |
| Fuzzing, hostile uploads | | none | not checked |
| Query count vs data size | | none | not checked |

Baseline at the time of writing: 957 unit tests in about 27 s, 63 end-to-end
tests in about 7.5 min, install 11 s, build 2 min 17 s.
