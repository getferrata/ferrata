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

Requires Node 22 or 24, and git. Both are covered by CI on Linux, macOS and
Windows, which matters more than it sounds: the SQLite driver is a compiled
module, so the platform and the Node version together decide which binary runs.

```
npm install -g pnpm@10
pnpm install
pnpm build
pnpm start      # http://localhost:3000
```

Build once, then start. There is no deploy step because Ferrata runs on your own
machine either way, which makes it tempting to reach for `next dev` instead: do
not. The development server compiles each page the first time you open it, so
every screen costs seconds and the wait reads as the product being slow; it
skips every optimisation; and it restarts whenever a file changes, which
interrupts a course being generated in the background worker. `pnpm dev` is for
working on Ferrata's own code.

On Windows, install pnpm this way rather than with `corepack enable`: corepack
writes into the Node installation directory, which needs an administrator shell,
and fails with `EPERM` in a normal one.

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
| `FERRATA_MODEL_HEAVY` / `FERRATA_MODEL_LIGHT` | one model per tier, addressed as `provider/model`, e.g. `anthropic/claude-opus-5` or `ollama/qwen2.5:7b`. Set, nothing is inferred |
| `FERRATA_DB_PATH` | SQLite database location (default `./ferrata.db`) |
| `FERRATA_ALLOW_PRIVATE_URLS=1` | allow fetching wiki links on private addresses (self-hosted networks) |
| `FERRATA_REPO_ROOTS` | allowlisted roots for local repository ingestion |
| `FERRATA_SECRET_KEY` | encrypts stored provider keys and wiki tokens at rest, and salts protected-value tokens |
| `FERRATA_OPEN_REGISTRATION` | `1` reopens sign-up; closed by default after the first account |
| `FERRATA_EXPORT_DIR` | directory allowed for package and note exports (default: system temp) |
| `FERRATA_TRACE_DIR` | write every prompt and reply here, one file per course. Off unless set, and on disk rather than in the database because a prompt carries your material: in the database it would follow every backup and export. Turn it on when a course does something you did not ask for, and `pnpm course:context <id>` will then say, per stage, whether your answers were in the prompt at all |
| `FERRATA_PUBLIC_URL` | the address this install answers on, used for social preview images |

Settings saved in the app take precedence over the environment.

## Which models work

Every stage asks for a convention rather than an API feature: an output that
stops at a ceiling, a body after a marker, a schema satisfied on the first try
or the call is billed and thrown away. A model can be perfectly healthy and
still cost double by ignoring one.

`pnpm preflight:row` runs the whole pipeline once on a built-in fixture and
prints a row for this table; the same run is a button on the Settings page. It
costs about twenty cents on a strong hosted model and nothing at all on a local
one. The row carries the model, the numbers, and the Ferrata version that
measured them, and nothing else: no course, no key, no identifier. Nothing is
sent anywhere, and the version travels with the numbers because prompts and
ceilings change between releases.

| Model | Provider | Stages | Verdict | Fixture cost | Calls discarded | Ferrata |
|---|---|---|---|---|---|---|
| claude-sonnet-5 | anthropic | 8/8 | clean | $0.2145 | 0 | 1.3.2 |
| qwen2.5:7b | ollama | 7/8 | broken | free | 4 | 1.3.1 |
| qwen2.5:3b | ollama | 6/8 | broken | free | 8 | 1.3.1 |
| qwen2.5:1.5b | ollama | 7/8 | broken | free | 4 | 1.3.1 |

**Stages** is how many of the eight produced something the schema accepted.
**Calls discarded** is how many were billed and thrown away, which is what
separates a usable model from an expensive one: zero is the only good number.
**Verdict** is `clean`, `wasteful` (works, pays for answers it cannot use) or
`broken` (a stage never produced anything).

**It is a floor, not a promise, and these rows show why.** The fixture is small.
The 1.5B scores better on it than the 3B and cannot finish a real course at all,
because a short answer satisfies a schema more easily than a long one. A model
that fails here will fail on a course; a model that passes here has shown only
that it holds the conventions on something easy.

Pull requests adding a row are welcome, and the only thing asked is that the row
comes from a run rather than from memory.

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
not suit Ferrata costs the price of one module to find out about, instead of half a
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
required. Build with `pnpm build` and run with `pnpm start`.

Everything is in the database, so backing it up backs up everything. Ferrata
does it for you: once a day, when the worker is idle, it writes a snapshot to
`backups/`, reopens the copy and counts what is in it, and keeps the newest
seven. Settings shows when the last one was taken and what was read back out of
it. `FERRATA_BACKUP_DIR`, `FERRATA_BACKUP_EVERY_HOURS` and
`FERRATA_BACKUP_KEEP` change where, how often and how many; zero hours turns the
schedule off.

Take one yourself before you upgrade, from Settings or with `pnpm db:backup`.
Never with `cp`: SQLite runs in WAL mode here, so while the app is running there
is a `ferrata.db-wal` alongside `ferrata.db` holding every write since the last
checkpoint, and copying the one file gives you a database quietly rolled back to
that checkpoint. It looks like a backup and is not one.

See `DEPLOY.md` for a full walkthrough: systemd service, TLS proxy, log
rotation, backups and updates.

## License

AGPL-3.0. You can use, modify and self-host Ferrata freely; if you offer a
modified version as a service, you must publish your changes under the same
license. See the LICENSE file.
