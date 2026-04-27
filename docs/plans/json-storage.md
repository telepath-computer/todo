# Plan: JSON storage rewrite

## Goal

Move task storage from per-project markdown files to a single JSON file. Give every task a stable ID that doesn't shift on mutation. Drop the markdown-specific machinery.

This is a focused storage swap with a few small model adjustments — not a redesign. Existing CLI display style (TTY colors, sections, picocolors) is preserved. Existing concepts (projects, contexts/categories, available/someday distinction, completion archive, due dates, task notes) all carry over with renamed fields.

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
  "projects": {
    "tel":    { "title": "Telepath", "note": null, "active": true, "completed": null, "dropped": null },
    "chores": { "title": "Chores",   "note": null, "active": true, "completed": null, "dropped": null }
  },
  "tasks": [
    { "id": 7, "project": "tel", "title": "Find guests", "available": true,
      "contexts": ["errand"], "due": "2026-05-01", "note": null,
      "created": "2026-04-27T10:14:32Z", "completed": null, "dropped": null },
    { "id": 42, "project": null, "title": "Pick up dry cleaning", "available": true,
      "contexts": ["errand"], "due": null, "note": null,
      "created": "2026-04-27T10:15:00Z", "completed": null, "dropped": null }
  ]
}
```

The top-level `contexts` array is the **registry** — a controlled vocabulary. Tasks may only use contexts from this list; unknown contexts are rejected. New contexts require explicit `todo contexts add <name>` (deliberate act, prevents slop like `imp` vs `important`). The store ships pre-populated with `["errand", "home", "waiting", "calls", "computer"]` as a sensible GTD-flavored starting set.

Pretty-printed (2-space indent, sorted keys) for clean diffs.

## Schema

```typescript
type Project = {
  title: string
  note: string | null
  active: boolean              // currently engaged with the project
  completed: string | null     // ISO ts when completed
  dropped: string | null       // ISO ts when dropped (mutually exclusive with completed)
}

type Task = {
  id: number                   // per-project namespace; never reused for the life of a task
  project: string | null       // slug; null for standalone tasks
  title: string                // required
  available: boolean           // true = next action; false = someday
  contexts: string[]           // each context must be in the registry; empty array if no contexts
  due: string | null           // YYYY-MM-DD
  note: string | null
  created: string              // ISO timestamp, auto-set on insert
  completed: string | null
  dropped: string | null       // mutually exclusive with completed
}
```

**ID assignment:** `max(existing ids where same project) + 1` on insert. IDs are unique within the (project | null) namespace, so `#7` and `tel#7` are distinct tasks. Once assigned, never reused.

**Refs:**
- Projected: `<slug>#<id>` (e.g. `tel#7`)
- Projectless: `#<id>` (e.g. `#42`)
- Slugs match `^[a-z0-9][a-z0-9.-]*$` (unchanged)

## Field migrations from existing

| Existing | New | Notes |
|---|---|---|
| `text` | `title` | rename |
| `notes` | `note` | rename, singular |
| `lane: available` | `available: true` | bool replaces 4-value lane |
| `lane: deferred` | `available: false` | someday |
| `lane: waiting` | `contexts: ["waiting"]` | waiting is just a context value (in the registry) |
| `lane: completed` | `completed: <iso>` set | derived from timestamp |
| `done` | (removed) | derived from `completed != null` |
| `contexts: string[]` | `contexts: string[]` | preserved; values must now be in the registry |
| `completedAt` | `completed` | rename |
| (new) | `id` | stable ID |
| (new) | `created` | ISO timestamp |
| (new) | `dropped` | ISO timestamp; alternative to `completed` |
| Project (new) | `active` | bool |
| Project (new) | `completed`, `dropped` | terminal states |

## Visibility / cascade rules

A task surfaces in `todo ls` (default actionable view) if **all** of:
- `task.available === true`
- `task.completed === null && task.dropped === null`
- Either `task.project === null` OR (`project.active === true && project.completed === null && project.dropped === null`)

A project surfaces in `todo ls` if `project.active && project.completed === null && project.dropped === null`.

## CLI surface

### Reads

```
todo ls                                # everything actionable: tasks + projects, mixed dashboard
todo ls --tasks                        # tasks only
todo ls --projects                     # projects only (with sections: Active / Inactive)
todo ls --context <name>               # filter tasks by context
todo ls --project <slug>               # tasks in one project
todo show <ref>                        # polymorphic — show a task or a project
                                       #   <slug>      → project drill-down (all its tasks regardless of state)
                                       #   <slug>#<id> → task detail
                                       #   #<id>       → standalone task detail
```

### Task mutations (top-level — most common)

```
todo add "<title>" [--project <slug>] [--context <name>]... [--due <date>] [--note <text>] [--available true|false]
todo edit <ref>    [--title ...] [--project ...] [--context <name>]... [--due ...] [--note ...] [--available true|false]
todo defer <ref>                       # sets available=false (someday)
todo activate <ref>                    # sets available=true (next action)
todo complete <ref>                    # sets completed=now, clears dropped
todo drop <ref>                        # sets dropped=now, clears completed
todo reopen <ref>                      # clears completed and dropped
```

`--available` defaults to `true` on `add`; pass `--available false` to file directly as someday. `defer`/`activate` are convenience verbs for flipping availability on existing tasks (parallel to `complete`/`reopen`).

`--context` is repeatable on `add` (initial set). On `edit`, repeated `--context` flags **replace** the entire set; pass `--context ""` once to clear.

### Project mutations (namespaced)

```
todo projects add <slug>    [--title <text>] [--note <text>]
todo projects edit <slug>   [--title ...] [--note ...] [--active true|false]
todo projects complete <slug>
todo projects drop <slug>
todo projects reopen <slug>
```

### Context registry (controlled vocabulary)

```
todo contexts ls                       # list registered contexts
todo contexts add <name>               # explicitly register a new context
todo contexts remove <name>            # errors if any item still uses it
```

Adding a task with an unregistered context is an error. The agent must either pick from existing contexts or run `todo contexts add <name>` first — keeps the vocabulary curated and prevents slop (e.g. `imp` vs `important`).

### Configuration

```
todo set-data-dir <path>               # writes dataDir to ~/.todo/config.json
todo config                            # prints resolved config (data-dir, etc.)
```

Path resolution: `TODO_DATA_DIR` env var (per-invocation override) > `~/.todo/config.json` `dataDir` > default `~/.todo/data/`.

### Defaults

- `todo add` without `--project` creates a standalone task (project=null)
- New tasks: `available: true`, `contexts: []`, `completed: null`, `dropped: null`
- New projects: `active: true`, `completed: null`, `dropped: null`
- Context registry ships pre-populated with `["errand", "home", "waiting", "calls", "computer"]`
- Adding a task with `--project X` or `--context X` where X isn't registered is an error (use `todo projects add X` / `todo contexts add X` first)

## Display

TTY-colored output, picocolors, existing style preserved. Default `todo ls`:

```
Tasks:
    [ ] Find guests [tel#7]
  @errand
    [ ] Buy mic [tel#3]
  @waiting
    [ ] Cover art [tel#8]

Projects:
  ✳ Telepath [tel]
  ✳ Chores [chores]
```

Tasks with multiple contexts appear once, under their first alphabetical context (same dedup logic as the existing `renderAvailableGrouped`). Items with no contexts render first, ungrouped. The full context set is shown on the task line in `todo show <ref>`.

`todo ls --projects` adds an Inactive section under Active.

`todo show <slug>` (project drill-down) shows the project header + all its tasks regardless of state, broken into Available / Someday / Completed / Dropped subsections.

## Code changes

### `src/core/`
- **`config.ts`** (rewritten) — resolves data-dir per the precedence rules (`TODO_DATA_DIR` env > `~/.todo/config.json` `dataDir` > default `~/.todo/data/`). Reads/writes `config.json` for `set-data-dir`.
- **New `store.ts`** — given a resolved data-dir, reads/writes `<data-dir>/store.json` with atomic write via tmpfile + rename. Pretty-print + sorted keys.
- **Replace `project.ts`** — schema types (`Project`, `Task`), pure validators, pure mutators (`addTask`, `editTask`, `setActive`, etc.). No I/O, no markdown.
- **Drop `vault.ts`** entirely.
- **`tasks.ts`** — keep result types; rename `lane` → `available`; rewire to store.
- **`ref.ts`** — parses `<slug>#<id>` and `#<id>`; resolver looks up by id field.
- **`errors.ts`** — keep `InvalidSlug`, `ProjectNotFound`, `ProjectAlreadyExists`, `NothingToEdit`, ref errors. Add `UnknownContext`. Drop `MalformedProject`.
- **`dates.ts`** — unchanged.

### `src/views/`
- **`task.ts`** — adapt to new field names; drop shift-note rendering.
- **`project.ts`** — adapt to new project shape.
- **`atoms.ts`** — unchanged.

### `src/commands/`
- **`tasks.ts`** — folded into top-level commands (no `tasks` namespace).
- **`projects.ts`** — `add`, `edit`, `complete`, `drop`, `reopen`.
- **`ls.ts`** (new) — unified read command with `--tasks`/`--projects`/`--category`/`--project` filters.
- **`show.ts`** (new) — polymorphic show by ref shape.
- **`config.ts`** — keeps `set-data-dir` and `config` (print resolved config); drops `set-vault`.
- **`list.ts`** — deleted (replaced by `ls.ts`).

### `src/cli.ts`
- Drop `--vault` global flag, `set-vault` subcommand.
- Add `set-data-dir <path>`, `config` (top-level).
- Drop `tasks list`, `lists list`, top-level `list` (replaced by `ls`).
- Drop `tasks <verb>` namespace; tasks verbs become top-level.
- Update tagline.

## Tests

- **`tests/project.test.ts`** — gut and rewrite. Schema validation, ID assignment (max+1 in scope), state transitions, round-trip notes/contexts, context-registry enforcement. Drop all markdown-parser tests.
- **`tests/cli.e2e.test.ts`** — survives mostly. Update commands (`tasks list` → `ls --tasks`, `projects show` → `show <slug>`, etc.), update on-disk reads to parse JSON, drop shift-advisory assertions.
- **`tests/tasks.test.ts`** — adapt to field renames, drop lane references, drop shift assertions.
- **`tests/ref.test.ts`** — handle `#<id>` (projectless) and `<slug>#<id>` resolution by id.
- **`tests/config.test.ts`** — rewrite for `set-data-dir` resolution (env > config > default).
- **`tests/helpers.ts`** — `makeTempVault` → `makeTempDataDir`; sets `TODO_DATA_DIR`.
- **`tests/dates.test.ts`** — unchanged.

## Docs

- **`README.md`** — rewrite. Drop "markdown / Obsidian / wikilinks" language. Show JSON example. Document `~/.todo/data/store.json` and `set-data-dir`.
- **`docs/spec.md`** — rewrite. New storage section, JSON schema, ID rule, new CLI surface.
- **`docs/cli.md`** — update commands.
- **`skill/SKILL.md`** — populate. Agent-facing docs: refs, ID rules, schema shape.
- **`docs/plans/task-status-and-notes-preamble.md`** and **`docs/plans/v0.2-implementation-sequence.md`** — leave as historical record.

## Order of work

1. Schema + `core/store.ts` + minimum unit tests for I/O.
2. Mutators in `core/project.ts` on the new schema. Get `tests/tasks.test.ts` green.
3. Update views and commands. Build `commands/ls.ts` and `commands/show.ts`. Wire up the new CLI surface.
4. Update `tests/cli.e2e.test.ts` for new commands and JSON storage.
5. Delete dead code: markdown parser/serializer, vault/config modules, shift rendering, `set-vault`/`--vault`, the dropped commands.
6. Rewrite docs and `skill/SKILL.md`.
7. `npm test`, manual smoke test.

## Out of scope

- Migration from `.md` files. There is none. Old vaults are abandoned; the CLI no longer reads them.
- Archive split (active/archive files). Deferred — single-file is fine for now; split when active.json grows uncomfortably large.
- Backwards-compat flags or syntax.
- Multiple data stores / vaults (only one data-dir at a time).
