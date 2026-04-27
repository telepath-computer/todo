# Plan: JSON storage rewrite

## Goal

Move task storage from per-project markdown files to a single JSON file. Give every task a stable ID that doesn't shift on mutation. Drop the markdown-specific machinery.

This is a focused storage swap with a few small model adjustments — not a redesign. Existing CLI display style (TTY colors, sections, picocolors) is preserved. Existing concepts (projects, contexts/categories, available/someday distinction, completion archive, due dates, task notes) all carry over with renamed fields.

## Storage

- Single file: `~/.todo/store.json`
- `TODO_HOME` env var as the only override (test use; undocumented for users)
- No config file, no `set-vault`, no `--vault` flag
- Archive split deferred — completed and dropped tasks stay in `store.json` for now, just filtered out of default views

File shape:

```json
{
  "tags": ["errand", "home", "waiting", "calls", "computer"],
  "projects": {
    "tel":    { "title": "Telepath", "note": null, "active": true, "completed": null, "dropped": null },
    "chores": { "title": "Chores",   "note": null, "active": true, "completed": null, "dropped": null }
  },
  "tasks": [
    { "id": 7, "project": "tel", "title": "Find guests", "available": true,
      "tags": ["errand"], "due": "2026-05-01", "note": null,
      "created": "2026-04-27T10:14:32Z", "completed": null, "dropped": null },
    { "id": 42, "project": null, "title": "Pick up dry cleaning", "available": true,
      "tags": ["errand"], "due": null, "note": null,
      "created": "2026-04-27T10:15:00Z", "completed": null, "dropped": null }
  ]
}
```

The top-level `tags` array is the **registry** — a controlled vocabulary. Tasks may only use tags from this list; unknown tags are rejected. New tags require explicit `todo tags add <tag>` (deliberate act, prevents slop). The store ships pre-populated with `["errand", "home", "waiting", "calls", "computer"]` as a sensible GTD-flavored starting set.

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
  tags: string[]               // each tag must be in the registry; empty array if untagged
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
| `lane: waiting` | `category: "waiting"` | waiting is just a category value |
| `lane: completed` | `completed: <iso>` set | derived from timestamp |
| `done` | (removed) | derived from `completed != null` |
| `contexts: string[]` | `tags: string[]` | renamed; multi-value preserved; values must be in registry |
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
todo ls --tag <tag>                    # filter tasks by tag
todo ls --project <slug>               # tasks in one project
todo show <ref>                        # polymorphic — show a task or a project
                                       #   <slug>      → project drill-down (all its tasks regardless of state)
                                       #   <slug>#<id> → task detail
                                       #   #<id>       → standalone task detail
```

### Task mutations (top-level — most common)

```
todo add "<title>" [--project <slug>] [--tag <tag>]... [--due <date>] [--note <text>] [--available true|false]
todo edit <ref>    [--title ...] [--project ...] [--tag <tag>]... [--due ...] [--note ...] [--available true|false]
todo defer <ref>                       # sets available=false (someday)
todo activate <ref>                    # sets available=true (next action)
todo complete <ref>                    # sets completed=now, clears dropped
todo drop <ref>                        # sets dropped=now, clears completed
todo reopen <ref>                      # clears completed and dropped
```

`--available` defaults to `true` on `add`; pass `--available false` to file directly as someday. `defer`/`activate` are convenience verbs for flipping availability on existing tasks (parallel to `complete`/`reopen`).

`--tag` is repeatable on `add` (initial set). On `edit`, repeated `--tag` flags **replace** the entire set; pass `--tag ""` once to clear.

### Project mutations (namespaced)

```
todo projects add <slug>    [--title <text>] [--note <text>]
todo projects edit <slug>   [--title ...] [--note ...] [--active true|false]
todo projects complete <slug>
todo projects drop <slug>
todo projects reopen <slug>
```

### Tag registry (controlled vocabulary)

```
todo tags ls                           # list registered tags
todo tags add <tag>                    # explicitly register a new tag
todo tags remove <tag>                 # errors if any item still uses it
```

Adding a task with an unregistered tag is an error. The agent must either pick from existing tags or run `todo tags add <tag>` first — keeps the vocabulary curated and prevents slop (e.g. `imp` vs `important`).

### Defaults

- `todo add` without `--project` creates a standalone task (project=null)
- New tasks: `available: true`, `tags: []`, `completed: null`, `dropped: null`
- New projects: `active: true`, `completed: null`, `dropped: null`
- Tag registry ships pre-populated with `["errand", "home", "waiting", "calls", "computer"]`
- Adding a task with `--project X` or `--tag X` where X isn't registered is an error (use `todo projects add X` / `todo tags add X` first)

## Display

TTY-colored output, picocolors, existing style preserved. Default `todo ls`:

```
Tasks:
  (untagged)
    [ ] Find guests [tel#7]
  @errand
    [ ] Buy mic [tel#3]
  @waiting
    [ ] Cover art [tel#8]

Projects:
  ✳ Telepath [tel]
  ✳ Chores [chores]
```

Tasks with multiple tags appear once, under their first alphabetical tag (same dedup logic as the existing `renderAvailableGrouped`). The full tag set is shown on the task line if rendered with `--verbose` or in `todo show`.

`todo ls --projects` adds an Inactive section under Active.

`todo show <slug>` (project drill-down) shows the project header + all its tasks regardless of state, broken into Available / Someday / Completed / Dropped subsections.

## Code changes

### `src/core/`
- **New `store.ts`** — resolves home (`TODO_HOME` || `~/.todo`), reads/writes `store.json`, atomic write via tmpfile + rename. Pretty-print + sorted keys.
- **Replace `project.ts`** — schema types (`Project`, `Task`), pure validators, pure mutators (`addTask`, `editTask`, `setStatus`, `setActive`, etc.). No I/O, no markdown.
- **Drop `vault.ts` and `config.ts`** entirely.
- **`tasks.ts`** — keep result types; rename `lane` → split fields; rewire to store.
- **`ref.ts`** — parses `<slug>#<id>` and `#<id>`; resolver looks up by id field.
- **`errors.ts`** — keep `InvalidSlug`, `ProjectNotFound`, `ProjectAlreadyExists`, `NothingToEdit`, ref errors. Drop `MalformedProject`.
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
- **`config.ts`** — deleted.
- **`list.ts`** — deleted (replaced by `ls.ts`).

### `src/cli.ts`
- Drop `--vault` global flag, `set-vault` subcommand.
- Drop `tasks list`, `lists list`, top-level `list` (replaced by `ls`).
- Drop `tasks <verb>` namespace; tasks verbs become top-level.
- Update tagline.

## Tests

- **`tests/project.test.ts`** — gut and rewrite. Schema validation, ID assignment (max+1 in scope), state transitions, round-trip notes/category. Drop all markdown-parser tests.
- **`tests/cli.e2e.test.ts`** — survives mostly. Update commands (`tasks list` → `ls --tasks`, `projects show` → `show <slug>`, etc.), update on-disk reads to parse JSON, drop shift-advisory assertions.
- **`tests/tasks.test.ts`** — adapt to field renames, drop lane references, drop shift assertions.
- **`tests/ref.test.ts`** — handle `#<id>` (projectless) and `<slug>#<id>` resolution by id.
- **`tests/config.test.ts`** — delete.
- **`tests/helpers.ts`** — `makeTempVault` → `makeTempHome`; sets `TODO_HOME`.
- **`tests/dates.test.ts`** — unchanged.

## Docs

- **`README.md`** — rewrite. Drop "markdown / Obsidian / wikilinks" language. Show JSON example. Document `~/.todo/store.json`.
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
- Multiple homes / vaults.
- Category registry / controlled vocabulary. Free-form for now; revisit if slop appears.
