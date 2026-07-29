# Ferrata

Turn your team's knowledge into a verified onboarding course.

Ferrata takes the material you already have, files, wiki pages, a code
repository, or a written brief, and builds a structured study path from it:
concrete modules grounded in your sources, tests placed right after each
concept, spaced repetition, and an honest measure of what each person
actually knows.

It runs on your own machine or server. Your material never leaves, and the
AI provider is your choice, under your own key, at cost.

## Highlights

- **Grounded generation.** Courses are built from your material and cite it.
  You review the plan before anything is generated, and you only build the
  modules you keep.
- **Verified readiness.** Not a completion bar: each module carries tests,
  answers feed a spaced-repetition schedule, and the dashboard shows what is
  solid, shaky, or untested, including the dangerous "sure and wrong".
- **Two roles.** Authors (examiners) create and assign courses, set per-person
  deadlines, and watch readiness. Students study and are measured.
- **Data protection built in.** Material passes through Contextia before any
  model sees it: secrets are stripped, internal addresses are shielded and
  restored into the finished course.
- **Provider agnostic.** Works with hosted models or a local one. Keys are
  stored locally, generation runs under your account, and one button checks a
  model against the whole pipeline before you build a course with it.
- **Linked knowledge bases.** Paste wiki links, optionally crawl same-site
  subpages (robots.txt respected), and store per-site tokens for pages behind
  sign-in.

## Quick start

Requires Node 22 and pnpm.

```
pnpm install
pnpm dev        # http://localhost:3000
```

The first registered account becomes the examiner, and sign-ups close behind
it: everyone after that comes in through an invite link you create, and the
link decides whether they arrive as a student or as an author who can build
courses. Open Settings to connect a
model: paste an API key or point Ferrata at a local model server, pick the
writing model from the list, and test the connection. Then create your first
course from a brief, files, links, or a repository path.

Try it with demo content:

```
pnpm db:seed:demo
```

## Configuration

Everything works from the in-app Settings page. For headless installs, the
same options are available as environment variables in `.env.local`:

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GROQ_API_KEY` | hosted model keys |
| `OPENAI_BASE_URL` | any OpenAI-compatible endpoint or gateway |
| `OLLAMA_BASE_URL` | local model server (default `http://127.0.0.1:11434`) |
| `*_MODEL_HEAVY` / `*_MODEL_LIGHT` | per-tier model overrides |
| `FERRATA_DB_PATH` | SQLite database location (default `./ferrata.db`) |
| `FERRATA_ALLOW_PRIVATE_URLS=1` | allow fetching wiki links on private addresses (self-hosted networks) |
| `FERRATA_REPO_ROOTS` | allowlisted roots for local repository ingestion |
| `FERRATA_SECRET_KEY` | encrypts stored provider keys and wiki tokens at rest, and salts protected-value tokens |
| `FERRATA_OPEN_REGISTRATION` | `1` reopens sign-up; closed by default after the first account |
| `FERRATA_EXPORT_DIR` | directory allowed for package and note exports (default: system temp) |

Settings saved in the app take precedence over the environment.

## Benchmarks and tests

Ferrata is measured, not asserted. Everything here is reproducible from a clean
checkout.

```
pnpm vitest run   # unit tests
pnpm test:e2e     # full journeys against a deterministic mock model
pnpm typecheck    # strict TypeScript
pnpm build        # production build
```

The end to end suite drives the real pipeline (background worker, generation,
review, export) with a local mock provider, so it runs in a couple of minutes
with no key and no cost.

**Data protection is deterministic.** On the secrets fixture, an author who
selects "off" still leaks zero secrets while the operator floor is `redact`: the
choice is clamped up to the floor. "Block" refuses a source with critical
secrets outright. Text passes through untouched only when the operator sets the
floor to `off` themselves.

**Runs on a normal server.** The self host target is a company VM with no GPU. On
a 4 vCPU, 15 GB machine, a 3B local model produces a full five module grounded
course, with its tests, in about half an hour. Generation is a background job of
minutes by design, which is why authoring is an async wizard you can close and
return to.

**On a hosted model.** One course built from a source repository of 131 files, on
a 4 hour study budget, came to 14 modules and 52 test questions, at $0.28 a
module for the calls the course kept. That is one course on one repository, not a
price list: material grounded generation carries the retrieved excerpts into
every module call, so a course written from a short brief costs materially less.
Generation is billed to your own key, and every course shows a receipt of what it
spent beside the estimate it gave beforehand, so the estimate can be checked
rather than believed.

**Check a model before you spend on it.** Settings has a preflight: one pass
through all eight stages of the pipeline over a small built in fixture, with the
models you have chosen. It reports what each stage produced, what it cost, and
whether any call had to be made twice. A few hundred tokens, so a model that does
not suit Ferrata costs a fraction of a cent to find out about instead of half a
course.

## Something wrong, something missing

- **A bug**: [open an issue](https://github.com/getferrata/ferrata/issues/new?template=bug_report.yml).
  What you did and what you saw instead is enough to start.
- **A feature**: [describe the situation](https://github.com/getferrata/ferrata/issues/new?template=feature_request.yml).
  Where the tool got in your way is more useful than a proposed solution.
- **A vulnerability**: report it privately through a
  [security advisory](https://github.com/getferrata/ferrata/security/advisories/new),
  not in a public issue. See `SECURITY.md`.

Either way, never paste keys, tokens, internal hostnames or your own material
into an issue: they are public.

## Deploy

Single Node process with a local SQLite file: a modest VM is enough, no GPU
required. Build with `pnpm build` and run with `pnpm start`. Back up the
database file to back up everything. See `DEPLOY.md` for a full walkthrough:
systemd service, TLS proxy, log rotation, backups and updates.

## License

AGPL-3.0. You can use, modify and self-host Ferrata freely; if you offer a
modified version as a service, you must publish your changes under the same
license. See the LICENSE file.
