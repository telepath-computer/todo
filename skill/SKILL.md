# todo — agent skill

You are using the `todo` CLI to manage GTD-style projects, actions, and waiting
items. All commands return JSON on stdout. Errors go to stderr (prefixed
`todo:`) with exit code 1.

## Quick reference

```
todo list                           # default: active actions, waiting, active projects
todo list --all                     # also: deferred actions, deferred projects
todo show <id>                      # full canonical entity
todo projects list                  # active + deferred projects

todo add "<title>" --active   [--project <id>] [--due <date>] [--note <text>]
todo add "<title>" --deferred [--project <id>] [--due <date>] [--note <text>]
todo add "<title>" --waiting  [--project <id>] [--note <text>]

todo edit <id> [--title ...] [--note ...] [--due ...] [--project ...]
todo projects add --title "<text>" [--note <text>]
todo projects edit <id> [--title ...] [--note ...]

todo activate <id>                  # active=true; clears terminal
todo defer <id>                     # active=false; clears terminal
todo complete <id>                  # completed=now
todo drop <id>                      # dropped=now

todo set-data-dir <abs-path>
todo config
```

## Entity types

The `type` field on every response disambiguates:

- **`project`** — multi-action outcome. Has `active`, `completed`, `dropped`.
  Used as a parent of items via `--project <id>`.
- **`action`** — concrete next action. Has `active` (true = next action,
  false = someday/maybe), optional `due`, `completed`, `dropped`, optional
  `list` (parent project).
- **`waiting`** — something you're waiting on someone else for. No `active`
  flag, no `due`. Has `completed`, `dropped`, optional `list`.

Every entity also has: `id` (8-char nanoid), `title`, `note`, `created`.

## Refs

Every command that takes `<id>` accepts the bare 8-char nanoid for any entity
type. The CLI resolves it across projects and items. There is no prefix or
typed-ref syntax. Save the `id` from a creation response to use it later.

## Common flows

### Capturing a new task with a deadline

```
todo add "Email Steve about Q2 plan" --active --project Vh8XLm2k --due tomorrow
```

`--due` accepts `YYYY-MM-DD` or natural language (`tomorrow`, `next friday`,
`in 3 days`). Always rendered back as `YYYY-MM-DD`.

### Capturing a someday/maybe

```
todo add "Read DDIA" --deferred
```

No project, no due date. Lives in `deferred_actions` until you `activate` it.

### Capturing what you're waiting for

```
todo add "Cover art from designer" --waiting --project Vh8XLm2k --note "Brief sent 2026-04-25"
```

### Marking work done or abandoned

```
todo complete K3jLm9pQ              # done
todo drop M9tBc4xR                  # decided not to do it
```

These set `completed` or `dropped` to the current ISO timestamp; they're
mutually exclusive (last write wins, the other is cleared).

### Reactivating a completed/dropped action or project

Use `activate` (back to live) or `defer` (back to someday/maybe). Both clear
terminal fields. There is no `reopen` verb.

```
todo activate K3jLm9pQ              # was completed, now active again
todo defer K3jLm9pQ                 # was completed, now deferred
```

Waiting items have **no resurrection path**. Once terminal, leave them. To
track a fresh ask, create a new waiting item.

### Pausing a project (and all its children)

```
todo defer Vh8XLm2k                 # project active=false
```

Children of a deferred project are hidden from `todo list` until you
`activate` the project again. Their own state is unchanged in storage.

### Editing

```
todo edit K3jLm9pQ --title "Find 3 guests" --due ""    # clear due date
todo edit P7nW3qZb --project ""                         # detach from project
todo edit Bn4Gh1Xt --note ""                            # clear note
```

Pass `""` to clear a field. Omit a flag to leave it unchanged. Empty patches
(no flags) error with `nothing to edit`.

## Output schemas

### `todo list` / `todo list --all`

```json
{
  "active_actions":    [ ...action ],
  "active_projects":   [ ...project ],
  "waiting":           [ ...waiting ],
  "deferred_actions":  [ ...action ],     // --all only
  "deferred_projects": [ ...project ]     // --all only
}
```

Filters applied:

- Excludes terminal items (`completed != null` or `dropped != null`).
- Excludes children of deferred or terminal projects from `active_actions`,
  `deferred_actions`, and `waiting`.
- Bucket name implies `active`/`type` — the entity still carries those fields.

### `todo projects list`

```json
{
  "active_projects":   [ ...project ],
  "deferred_projects": [ ...project ]
}
```

Terminal projects (completed/dropped) excluded.

### `todo show <id>` and mutation responses

A single canonical entity, identical shape to what's in `store.json`. No
fields dropped. The `type` discriminator tells you which subtype it is.

## Errors

Plain text on stderr, exit 1. Common cases:

- `not found: <id>` — wrong nanoid.
- `nothing to edit` — `todo edit <id>` with no patch flags.
- `--active, --deferred, or --waiting is required` — `todo add` without a mode.
- `--due is not allowed on waiting items` — waiting items have no due field.
- `unknown project: <id>` — `--project <id>` doesn't resolve.
- `cannot activate waiting item <id> (no active flag)` — `activate`/`defer`
  on a waiting item.
- `data dir must be an absolute path (...)` — relative path in env or config.

Always parse stdout as JSON; stderr is human-readable, not structured.

## Storage

Single JSON file at `<data-dir>/store.json`. Default `~/.todo/data/store.json`.
Override with `TODO_DATA_DIR` env var (absolute path) or
`todo set-data-dir <abs-path>`.

Pretty-printed with sorted keys — safe to commit, sync, or hand-edit. Atomic
writes. If you ever see a stack trace instead of a `todo: …` error, that's a
bug — please report.
