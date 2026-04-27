# Plan: JSON storage rewrite

## Goal

Move task storage from per-project markdown files to a single JSON file. Give every entity a stable, opaque ID (nanoid) that doesn't shift on mutation. Drop the markdown-specific machinery.

A focused storage swap with an agent-first reorientation: the CLI is invoked by an LLM agent (primary) and humans (secondary). All data is structured JSON; refs are nanoid-based; the CLI keeps the existing `todo <namespace> <verb>` shape (e.g. `todo tasks add`, `todo projects list`) for clarity and clean separation between task and project semantics.

## Storage

Default layout:

```
~/.todo/
├── config.json        # CLI config (data-dir override, etc.)
└── data/
    └── store.json     # all data
```

- Data file: `<data-dir>/store.json`. Default data-dir is `~/.todo/data/`.
- Data-dir is configurable — users who want their data elsewhere (Dropbox, iCloud Drive, an external sync mechanism) can redirect it.
- Resolution order: `TODO_DATA_DIR` env var (per-invocation override) > `config.json` `dataDir` setting > default `~/.todo/data/`.
- `~/.todo/config.json` is always at this fixed path; only the data location moves.
- Archive split deferred — completed and dropped tasks stay in `store.json` for now, just filtered out of default views.

`config.json` shape (only `dataDir` for now; room to grow):

```json
{
  "dataDir": "/Users/rupert/Dropbox/todo"
}
```

`store.json` shape:

```json
{
  "contexts": ["errand", "home", "waiting", "calls", "computer"],
  "projects": [
    { "id": "Vh8XLm2k", "title": "Telepath", "note": null,
      "status": "actionable", "closed": null }
  ],
  "tasks": [
    { "id": "K3jLm9pQ", "project": "Vh8XLm2k", "title": "Find guests",
      "status": "actionable", "closed": null,
      "contexts": ["errand"], "due": "2026-05-01", "note": null,
      "created": "2026-04-27T10:14:32Z" },
    { "id": "P7nW3qZb", "project": null, "title": "Pick up dry cleaning",
      "status": "actionable", "closed": null,
      "contexts": ["errand"], "due": null, "note": null,
      "created": "2026-04-27T10:15:00Z" }
  ]
}
```

The top-level `contexts` array is the **registry** — a controlled vocabulary. Tasks may only use contexts from this list; unknown contexts are rejected. New contexts require explicit `todo contexts add <name>` (deliberate act, prevents slop like `imp` vs `important`). The store ships pre-populated with `["errand", "home", "waiting", "calls", "computer"]` as a sensible GTD-flavored starting set.

Pretty-printed (2-space indent, sorted keys) for clean diffs.

## Schema

Single status enum, shared by both Project and Task:

```typescript
type Status = "actionable" | "deferred" | "completed" | "dropped"

type Project = {
  id: string                   // nanoid (8 chars); canonical handle
  title: string                // human-readable name
  note: string | null
  status: Status
  closed: string | null        // ISO ts; non-null iff status is "completed" or "dropped"
}

type Task = {
  id: string                   // nanoid (8 chars); canonical handle, never reused
  project: string | null       // project ID; null for standalone tasks
  title: string
  status: Status
  closed: string | null
  contexts: string[]           // each context must be in the registry; empty array if no contexts
  due: string | null           // YYYY-MM-DD
  note: string | null
  created: string              // ISO timestamp, auto-set on insert
}
```

The four statuses are mutually exclusive. `closed` is set to the timestamp of the transition into a terminal state; for `actionable` and `deferred` it must be null.

**IDs:** 8-char nanoids (alphanumeric, URL-safe), generated on insert. Never reused. Globally unique across the store. Multi-device-safe: each device generates its own IDs without coordination.

**Refs:** the `id` itself, plain. `Vh8XLm2k` for project, `K3jLm9pQ` for task. Refs are scoped by their command namespace: `todo tasks <verb> <id>` expects a task ID and `todo projects <verb> <id>` expects a project ID. No cross-space lookup needed.

## Field migrations from existing

| Existing | New | Notes |
|---|---|---|
| `text` | `title` | rename |
| `notes` | `note` | rename, singular |
| `lane: available` | `status: "actionable"` | enum replaces 4-value lane |
| `lane: deferred` | `status: "deferred"` | someday |
| `lane: waiting` | `contexts: ["waiting"]` | waiting is just a context value |
| `lane: completed` | `status: "completed"`, `closed: <iso>` | terminal |
| `done` | (removed) | derived from `status === "completed"` |
| `contexts: string[]` | `contexts: string[]` | preserved; values must now be in the registry |
| `completedAt` | `closed` | rename; same field for completed and dropped |
| project slug | project nanoid | slugs gone; titles still human-readable |
| (new) | `id` (nanoid) | stable ID for both projects and tasks |
| (new) | `created` | ISO timestamp |
| (new) | `status: "dropped"`, `closed: <iso>` | new terminal state distinct from completed |

## Visibility / cascade rules

A task surfaces in the default `todo tasks list` and `todo list` if **all** of:
- `task.status === "actionable"`
- Either `task.project === null` OR `project.status === "actionable"`

A project surfaces in default views if `project.status === "actionable"`.

`--all` widens to include `status === "deferred"`. `--completed` and `--dropped` show those terminal sets explicitly.

## CLI surface

### Reads

```
todo list                              # cross-cutting dashboard: actionable tasks + projects
todo list --all                        # also include deferred

todo tasks list                        # actionable tasks
todo tasks list --all                  # actionable + deferred
todo tasks list --completed            # completed tasks
todo tasks list --dropped              # dropped tasks
todo tasks show <id>                   # task detail

todo projects list                     # actionable projects
todo projects list --all               # actionable + deferred
todo projects list --completed         # completed projects
todo projects list --dropped           # dropped projects
todo projects show <id>                # project drill-down (all its tasks regardless of status)
```

### Task mutations

```
todo tasks add "<title>" [--project <id>] [--context <name>]... [--due <date>] [--note <text>] [--status <s>]
todo tasks edit <id>     [--title ...] [--note ...] [--due ...] [--project ...] [--context <name>]... [--status <s>]
todo tasks defer <id>                  # status: deferred
todo tasks activate <id>               # status: actionable
todo tasks complete <id>               # status: completed, closed: now
todo tasks drop <id>                   # status: dropped, closed: now
todo tasks reopen <id>                 # status: actionable, closed: null
```

### Project mutations

```
todo projects add --title "<text>" [--note <text>]
todo projects edit <id>     [--title ...] [--note ...] [--status <s>]
todo projects defer <id>
todo projects activate <id>
todo projects complete <id>
todo projects drop <id>
todo projects reopen <id>
```

`add` operations return the new entity (including its ID) so the agent can chain.

`--status` defaults to `actionable` on `add`. Verbs (`defer`/`activate`/`complete`/`drop`/`reopen`) are common-case shortcuts; `--status <value>` on `edit` is the explicit form. Setting `--status completed` or `--status dropped` also sets `closed = now`; setting any non-terminal status clears `closed`.

`--context` is repeatable on `tasks add` (initial set). On `tasks edit`, repeated `--context` flags **replace** the entire set; pass `--context ""` once to clear.

### Context registry (controlled vocabulary)

```
todo contexts list                     # list registered contexts
todo contexts add <name>               # explicitly register a new context
todo contexts remove <name>            # errors if any task still uses it
```

Adding a task with an unregistered context is an error. The agent must either pick from existing contexts or run `todo contexts add <name>` first.

### Configuration

```
todo set-data-dir <path>               # writes dataDir to ~/.todo/config.json
todo config                            # prints resolved config (data-dir, etc.)
```

Resolution: `TODO_DATA_DIR` env > `~/.todo/config.json` `dataDir` > default `~/.todo/data/`.

### Defaults

- `todo tasks add` without `--project` creates a standalone task (`project: null`)
- New tasks: `status: "actionable"`, `contexts: []`, `closed: null`
- New projects: `status: "actionable"`, `closed: null`
- Context registry ships pre-populated with `["errand", "home", "waiting", "calls", "computer"]`
- Adding a task with `--project X` or `--context X` where X isn't registered/found is an error

## Display

TTY-colored output, picocolors, existing style preserved. `todo list` (default dashboard):

```
Tasks:
    [ ] Find guests [K3jLm9pQ]
  @errand
    [ ] Buy mic [P7nW3qZb]
  @waiting
    [ ] Cover art [Bn4Gh1Xt]

Projects:
  ✳ Telepath [Vh8XLm2k]
  ✳ Chores   [Yk2Lm9wT]
```

Tasks with multiple contexts appear once, under their first alphabetical context (same dedup logic as the existing `renderAvailableGrouped`). Items with no contexts render first, ungrouped. The full context set is shown on the task line in `todo tasks show <id>`.

`todo projects show <id>` (project drill-down) shows the project header + all its tasks regardless of status, broken into Actionable / Deferred / Completed / Dropped subsections.

## Code changes

### `src/core/`
- **`config.ts`** (rewritten) — resolves data-dir per the precedence rules. Reads/writes `config.json` for `set-data-dir`.
- **New `store.ts`** — given a resolved data-dir, reads/writes `<data-dir>/store.json` with atomic write via tmpfile + rename. Pretty-print + sorted keys. Generates nanoids on insert.
- **Replace `project.ts`** — schema types (`Project`, `Task`, `Status`), pure validators, pure mutators (`addTask`, `editTask`, `setStatus`, etc.). No I/O, no markdown.
- **Drop `vault.ts`** entirely.
- **`tasks.ts`** — keep result types; rewire to store.
- **`ref.ts`** — refs are bare nanoid strings; resolver scoped by command namespace.
- **`errors.ts`** — keep `NotFound`, `AlreadyExists`, `NothingToEdit`, `UnknownContext`. Drop `MalformedProject`, `InvalidSlug` (no slugs).
- **`dates.ts`** — unchanged.

### `src/views/`
- **`task.ts`** — adapt to new field names; drop shift-note rendering.
- **`project.ts`** — adapt to new project shape (now has its own `id`).
- **`atoms.ts`** — unchanged.

### `src/commands/`
- **`list.ts`** — top-level dashboard (`todo list`).
- **`tasks.ts`** — `list`, `show`, `add`, `edit`, `defer`, `activate`, `complete`, `drop`, `reopen`.
- **`projects.ts`** — `list`, `show`, `add`, `edit`, `defer`, `activate`, `complete`, `drop`, `reopen`.
- **`contexts.ts`** (new) — `list`, `add`, `remove`.
- **`config.ts`** — `set-data-dir` and `config`.

### `src/cli.ts`
- Drop `--vault` global flag, `set-vault` subcommand.
- Add `set-data-dir <path>`, `config`, `contexts <verb>`.
- Update top-level `list` (replaces existing markdown-era version).
- Update `tasks <verb>`: drop `lane`-related args; add `defer`/`activate`/`drop`/`reopen`; drop `uncomplete` (use `reopen` instead).
- Update `projects <verb>`: same set of verbs as tasks (`list`/`show`/`add`/`edit`/`defer`/`activate`/`complete`/`drop`/`reopen`).
- Update tagline.

## Tests

- **`tests/project.test.ts`** — gut and rewrite. Schema validation, status transitions, round-trip notes/contexts, context-registry enforcement, nanoid generation. Drop all markdown-parser tests.
- **`tests/cli.e2e.test.ts`** — survives mostly. Update commands to new surface (status flags on `list`, new verbs, project drill-down by ID), update on-disk reads to parse JSON, drop shift-advisory assertions.
- **`tests/tasks.test.ts`** — adapt to field renames, status enum, drop lane references, drop shift assertions.
- **`tests/ref.test.ts`** — refs are bare nanoids; lookup scoped by namespace.
- **`tests/config.test.ts`** — rewrite for `set-data-dir` resolution (env > config > default).
- **`tests/helpers.ts`** — `makeTempVault` → `makeTempDataDir`; sets `TODO_DATA_DIR`.
- **`tests/dates.test.ts`** — unchanged.

## Docs

- **`README.md`** — rewrite. Drop "markdown / Obsidian / wikilinks" language. Show JSON example. Document `~/.todo/data/store.json` and `set-data-dir`.
- **`docs/spec.md`** — rewrite. New storage section, JSON schema, status enum, ID rule, new CLI surface.
- **`docs/cli.md`** — update commands.
- **`skill/SKILL.md`** — populate. Agent-facing docs: ref shape, status enum, schema, common flows.
- **`docs/plans/task-status-and-notes-preamble.md`** and **`docs/plans/v0.2-implementation-sequence.md`** — leave as historical record.

## Order of work

1. Schema + `core/store.ts` + `core/config.ts` + minimum unit tests for I/O and config resolution.
2. Mutators in `core/project.ts` on the new schema. Get `tests/tasks.test.ts` green.
3. Wire up CLI namespaces (`tasks`, `projects`, `contexts`, top-level `list`/`config`). Update `cli.ts`.
4. Update `tests/cli.e2e.test.ts` for new commands and JSON storage.
5. Delete dead code: markdown parser/serializer, vault module, shift rendering, `set-vault`/`--vault`, `lane`-specific flags.
6. Rewrite docs and `skill/SKILL.md`.
7. `npm test`, manual smoke test.

## Out of scope

- Migration from `.md` files. There is none. Old vaults are abandoned.
- Archive split (active/archive files). Deferred — single-file is fine for now.
- Backwards-compat flags or syntax.
- Multiple data stores / vaults (only one data-dir at a time).
- Multi-device merge logic. Nanoids prevent ID collisions but JSON-array merge on simultaneous offline edits is still out of scope; rely on a single writer at a time for now.
