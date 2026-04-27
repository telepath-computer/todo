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
  for natural-language `--due`.
- **No UI framework, no colors.** Output is JSON only; pretty-printed with
  sorted keys via `JSON.stringify(value, sortedReplacer, 2)`.

## Architecture

Three layers, no view layer (storage shape == display shape):

```
src/
├── cli.ts                 commander wiring
├── commands/              thin glue: parse args → call model → persist → JSON.stringify
│   ├── add.ts             addProjectCmd / addActionCmd / addWaitingCmd
│   ├── config.ts          set-data-dir / config
│   ├── edit.ts            polymorphic on entity (project / action / waiting)
│   ├── lifecycle.ts       activate / defer / complete / drop
│   ├── list.ts            todo list (with --all)
│   ├── shared.ts          json() helper
│   └── show.ts
└── core/
    ├── config.ts          ~/.todo/config.json + dataDir resolution (env > config > default)
    ├── dates.ts           --due parser (chrono-node)
    ├── errors.ts          DoError, NotFound, NothingToEdit, InvalidArgument, InvalidDate
    ├── model.ts           types, mutators, bucket helpers, resolveRef, lookups
    └── store.ts           store.json I/O, atomic write, nanoid, sorted-key stringify
```

### Layer rules

- **`store.ts`** is the only module that touches the data file. Atomic
  tmpfile + rename + fsync. Reads return `EMPTY_STORE` if the file is missing.
  Catches `JSON.parse` and rethrows as `DoError("malformed store.json at …")`
  so the CLI surfaces a clean message instead of a stack trace.
- **`model.ts`** is pure. No I/O, no `Date.now()`, no `process.env`. Mutators
  take the current `Store` and an input that includes any non-deterministic
  values (`id`, `created_at`, `ts`); they return `{ store, entity }`. Validators
  throw typed errors. Bucket helpers (`liveActions`, `deferredActions`,
  `liveWaiting`, `activeProjects`, `deferredProjects`) implement filter rules
  including parent-state cascade.
- **`config.ts`** is the gate for data-dir paths. Both `writeConfig` and
  `resolveDataDir` reject non-absolute paths via a shared `requireAbsolute`
  check. `TODO_DATA_DIR=relative/foo` fails fast on resolve.
- **`commands/*.ts`** each export one or two functions; every command body is
  the same shape: resolve data dir → read store → mutate via model → write
  store → return JSON. No business logic.
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
- **E2E (`cli.e2e.test.ts`):** spawns the compiled `dist/cli.js` via
  `child_process.spawnSync` with a sandboxed `$HOME` and `TODO_DATA_DIR`.
  Every one of the 13 commands has at least one happy-path test plus error
  paths (NotFound, NothingToEdit, mutually-exclusive flags, waiting +
  lifecycle, relative paths, malformed store, unparseable `--due`, chrono
  natural language, parent-deferred cascade, `ls` alias).

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
- **Clearing:** the CLI translates `--note ""` to `null` before calling the
  mutator. The mutator sees `note: null` and stores it. The mutator never
  sees the empty string.
