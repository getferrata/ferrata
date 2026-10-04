# Contributing

Thanks for looking. This is how to get from a clone to a passing test run, and
what a change is expected to carry.

## Setup

Needs Node 22 or 24, git, and pnpm 10.

```
npm install -g pnpm@10
pnpm install
```

On Windows, install pnpm this way rather than with `corepack enable`, which needs
an administrator shell.

## Checks

| Command | What it runs | Time |
|---|---|---|
| `pnpm lint` | ESLint | ~30 s |
| `pnpm typecheck` | `tsc --noEmit` | ~15 s |
| `pnpm test` | unit tests (`tests/`) | ~30 s |
| `pnpm test:e2e` | end-to-end journeys in Chromium (`e2e/`) | ~8 min |
| `pnpm audit:deps` | production dependencies against the npm advisory database | seconds |
| `pnpm check:upgrade` | every released version's database upgraded to this checkout | ~20 s |

`pnpm test:e2e` needs a browser once: `pnpm exec playwright install chromium`.
`pnpm check:upgrade` needs the release tags: `git fetch --tags`.

Lint, types and unit tests are the minimum for any pull request. Run the
end-to-end suite when you touch routes, pages or the job pipeline. CI runs all of
it, plus a build and a real server start on Windows, macOS and Linux.

## What a change carries

- **A fix comes with a test that fails without it.** Write the test, run it
  against the current code and watch it fail, then fix. A test that has never
  failed may be passing for the wrong reason.
- **Say what you did not check.** A pull request that is honest about its limits
  is easier to merge than one that implies more coverage than it has.
- **Migrations are append-only.** Never edit a migration that has shipped:
  `pnpm check:upgrade` fails on it, because a database already past that point
  would end up different from a fresh one. Add a new one with `pnpm db:generate`.
- **The database is SQLite in WAL mode.** Use `pnpm db:backup` rather than
  copying the file, and see the Backup section of `DEPLOY.md`.
- Keep comments for the reason, not the mechanics. The existing ones explain what
  went wrong before, which is what the next reader needs.

## Running it

```
pnpm build
pnpm start      # http://localhost:3000
pnpm db:seed:demo
```

Use `pnpm dev` only for working on Ferrata's own code: it recompiles each page on
first visit and restarts when files change, which interrupts a running build.

## Reporting a vulnerability

Privately, not in a public issue. See `SECURITY.md`.
