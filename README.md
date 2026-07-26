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
  stored locally and generation runs under your account.
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
| `FERRATA_SECRET_KEY` | encrypts stored provider keys and wiki tokens at rest |
| `FERRATA_OPEN_REGISTRATION` | `1` reopens sign-up; closed by default after the first account |

Settings saved in the app take precedence over the environment.

## Tests

```
pnpm test        # unit
pnpm test:e2e    # full journeys against a deterministic mock model
```

The e2e suite drives the real pipeline (jobs, statuses, UI) with a local mock
provider, so it runs in about two minutes with no key and no cost.

## Deploy

Single Node process with a local SQLite file: a modest VM is enough, no GPU
required. Build with `pnpm build` and run with `pnpm start`. Back up the
database file to back up everything. See `DEPLOY.md` for a full walkthrough:
systemd service, TLS proxy, log rotation, backups and updates.

## License

AGPL-3.0. You can use, modify and self-host Ferrata freely; if you offer a
modified version as a service, you must publish your changes under the same
license. See the LICENSE file.
