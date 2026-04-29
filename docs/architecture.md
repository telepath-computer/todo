# Architecture

Implementation notes for the `todo` CLI. The user-facing surface is in
[spec.md](./spec.md); this file records architecture and conventions.

## Stack

- **Language:** Node.js + TypeScript (`tsc` to `dist/`).
- **Args:** [`commander`](https://www.npmjs.com/package/commander) — handles
  nested subcommands cleanly.
- **IDs:** [`nanoid`](https://www.npmjs.com/package/nanoid) with custom 8-char
  alphanumeric alphabet.
- **Date parsing:** [`chrono-node`](https://www.npmjs.com/package/chrono-node)
  for natural-language `--due`, `--start`, and `--date`.
- **No UI framework, no colors.** Output is markdown narrative for read
  commands (rendered by `core/render.ts`); mutation responses are
  pretty-printed sorted-key JSON via `JSON.stringify(value, sortedReplacer, 2)`.

## Architecture

```
src/
├── cli.ts                 commander wiring
├── commands/              thin glue: parse args → call core → render → write/print
│   ├── add.ts             addProjectCmd / addActionCmd / addWaitingCmd / addDeadlineCmd
│   ├── addMemo.ts         addMemoCmd
│   ├── config.ts          config (read/list/write keys; data_dir)
│   ├── dashboard.ts       bare `todo` — calls renderDashboard + renderHints
│   ├── edit.ts            polymorphic on entity (project / action / waiting / deadline / memo)
│   ├── lifecycle.ts       activate / defer / complete / drop
│   ├── list.ts            `todo list <type>` flat enumeration
│   ├── review.ts          `todo review` — broader weekly read surface
│   ├── shared.ts          json() helper
│   └── show.ts            single-entity narrative (projects embed children; memos render as blocks)
└── core/
    ├── config.ts          ~/.todo/config.json + data_dir resolution (env > config > default)
    ├── dates.ts           --due / --date parser (chrono-node), todayLocal, requireFutureDate
    ├── errors.ts          DoError, NotFound, NothingToEdit, InvalidArgument, InvalidDate
    ├── hints.ts           Hint trigger functions (lapsed deadlines, stalled projects, stale waiting, deferred count) + mode-aware renderHints composer
    ├── model.ts           types, mutators, memo helpers, bucket helpers, resolveRef, lookups
    ├── render.ts          narrative formatting: dayDelta, modifiers, item lines, memo blocks, dashboard, review, list, show
    └── store.ts           store.json I/O, atomic write, nanoid, sorted-key stringify, one-shot legacy context→memo migration
```

### Layer rules

- **`store.ts`** is the only module that touches the data file. Atomic
  tmpfile + rename + fsync. Reads return `EMPTY_STORE` if the file is missing.
  Catches `JSON.parse` and rethrows as `DoError("malformed store.json at …")`
  so the CLI surfaces a clean message instead of a stack trace. `readStore`
  also normalises forward-compatibility fields — actions written by older
  versions get any missing fields (e.g. `start_at`) defaulted to `null` on
  read, so the rest of the code can treat the schema as strict. The one
  legacy migration is `meta.context`: on read, a non-empty value becomes a
  pinned memo and the field is dropped from the normalized store.
- **`model.ts`** is pure. No I/O, no `Date.now()`, no `process.env`. Mutators
  take the current `Store` and an input that includes any non-deterministic
  values (`id`, `created_at`, `ts`); they return `{ store, entity }`.
  `setStatus` takes a discriminated `StatusTransition` so each branch carries
  exactly the data it needs (`closed_at` for terminal, `start_at` for
  deferred). Validators throw typed errors. Bucket helpers (`liveActions`,
  `deferredActions`, `liveWaiting`, `activeProjects`, `deferredProjects`,
  `activeDeadlines`, `reviewDeadlines`, `allMemos`, `pinnedMemos`) implement
  filter rules including parent-state cascade and the past-due-scheduled
  bridge: a deferred action with `start_at <= today` shows up in
  `liveActions` and is excluded from `deferredActions`. Memos are items too,
  but they deliberately have no status; `setStatus` rejects memo ids and
  `drop` hard-deletes them.
  `activeDeadlines` and the action helpers all take a `today: string`
  (YYYY-MM-DD) parameter so the model stays free of `Date.now()`;
  `commands/list.ts` computes today via `todayLocal()`.
- **`dates.ts`** parses `--due`/`--start`/`--date` inputs (chrono + ISO
  passthrough) and exposes `todayLocal()` and `requireFutureDate()` for the
  strictly-future invariant on `start_at` and deadline `date`.
- **`config.ts`** is the gate for data-dir paths. Both `writeConfig` and
  `resolveDataDir` reject non-absolute paths via a shared `requireAbsolute`
  check. `TODO_DATA_DIR=relative/foo` fails fast on resolve.
- **`commands/*.ts`** each export one or two functions; every command body is
  the same shape: resolve data dir → read store → mutate via model → write
  store → return JSON, or resolve data dir → read store → render a read
  surface. No business logic.
- **`cli.ts`** is commander wiring + a single `try/catch` that prints
  `todo: <DoError.message>` to stderr and exits 1. Anything other than a
  `DoError` propagates as a stack trace (programmer bug).

### Why no view layer

Earlier iterations imagined a "display projection" that dropped fields the
user doesn't need (`type` discriminator, `active` when implicit from bucket).
After landing on one canonical shape per type — same in storage, lists, show,
and mutation responses — projection became identity. Bucketing/filtering for
list views lives next to the model as helper functions; there's no separate
`view.ts`.

## Tests

Test runner: `node --import tsx --test tests/*.test.ts`. Three layers:

- **Unit (`model.test.ts`, `store.test.ts`, `config.test.ts`, `dates.test.ts`):**
  pure-function tests for mutators, invariants, bucket-helper filtering,
  immutability, sorted-key serialization, atomic write, env > config > default
  resolution, `requireAbsolute` rejection, malformed-store error.
- **E2E (`cli.e2e.test.ts`, `memos.e2e.test.ts`):** spawns the compiled `dist/cli.js` via
  `child_process.spawnSync` with a sandboxed `$HOME` and `TODO_DATA_DIR`.
  Covers the daily dashboard, review, positional add commands, memo CRUD,
  lifecycle errors, parent-deferred cascade, malformed store, relative
  paths, and natural-language date parsing.

## Conventions

- **Errors:** all anticipated error paths throw `DoError` (or one of its
  subclasses). The CLI catches and prints `todo: <message>`. Do not throw
  plain `Error` for user-facing problems — that triggers a stack trace.
- **Time:** mutators take a `created` / `ts` string from the caller. Only
  `commands/*.ts` reach into `nowIso()`. This keeps mutator tests
  deterministic.
- **IDs:** same — generated in `commands/*.ts` via `newId()`, never inside
  mutators.
- **Empty patches:** edit mutators reject `{}` with `NothingToEdit`. The CLI
  passes through whatever flags commander parsed; "no flags" produces an
  empty patch.
- **Clearing:** `--due ""`, `--project ""`, and `--start ""` are translated
  by the CLI before calling the mutator. Memo `--note ""` is not a clear;
  it is rejected because memo bodies are required.
