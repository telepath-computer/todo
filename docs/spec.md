# todo — spec

JSON-storage CLI for GTD-style projects, actions, waiting items, and deadlines.
Agent-first; JSON-only output.

## Storage

```
~/.todo/
├── config.json        # CLI config (data-dir override)
└── data/
    └── store.json     # all data
```

- Data file: `<data-dir>/store.json`. Default data-dir is `~/.todo/data/`.
- Resolution order: `TODO_DATA_DIR` env var → `dataDir` in `~/.todo/config.json` → default.
- All data-dir paths must be **absolute**. Relative paths are rejected at every entry.
- Atomic writes via tmpfile + rename. Pretty JSON, sorted keys, trailing newline.

`config.json`:

```json
{
  "dataDir": "/Users/rupert/Dropbox/todo"
}
```

`store.json`:

```json
{
  "lists": [
    {
      "closed_at": null,
      "created_at": "2026-04-27T10:14:00Z",
      "id": "Vh8XLm2k",
      "note": "Indie thinking tool.",
      "status": "active",
      "title": "Telepath",
      "type": "project"
    }
  ],
  "items": [
    {
      "closed_at": null,
      "created_at": "2026-04-27T10:14:32Z",
      "due": "2026-05-01",
      "id": "K3jLm9pQ",
      "note": null,
      "project": "Vh8XLm2k",
      "start_at": null,
      "status": "active",
      "title": "Find guests",
      "type": "action"
    }
  ]
}
```

## Schema

Discriminated subtypes — each entity carries only the fields it actually has.

```typescript
type Status = 'active' | 'deferred' | 'completed' | 'dropped'
type WaitingStatus = Exclude<Status, 'deferred'>   // 'active' | 'completed' | 'dropped'
type DeadlineStatus = 'active' | 'dropped'         // no 'deferred', no 'completed'

type BaseList = {
  id: string                   // 8-char nanoid
  title: string                // non-empty
  note: string | null
  created_at: string           // ISO 8601, set on insert, never edited
}

type ProjectList = BaseList & {
  type: 'project'
  status: Status
  closed_at: string | null     // ISO; non-null iff status is completed/dropped
}

type List = ProjectList         // future: more list subtypes

type BaseItem = {
  id: string
  project: string | null       // parent project id; null = standalone
  title: string
  note: string | null
  created_at: string
}

type ActionItem = BaseItem & {
  type: 'action'
  status: Status
  due: string | null           // YYYY-MM-DD
  start_at: string | null      // YYYY-MM-DD; only meaningful when status='deferred'
  closed_at: string | null
}

type WaitingItem = BaseItem & {
  type: 'waiting'
  status: WaitingStatus        // no 'deferred' for waiting
  closed_at: string | null
}

type DeadlineItem = BaseItem & {
  type: 'deadline'
  status: DeadlineStatus       // 'active' | 'dropped' only
  date: string                 // YYYY-MM-DD; required, never null
  closed_at: string | null     // non-null iff status='dropped'
}

type Item = ActionItem | WaitingItem | DeadlineItem

type Store = { lists: List[]; items: Item[] }
```

### Invariants

- `closed_at` is non-null iff `status` is `completed` or `dropped`.
- `WaitingItem.status` excludes `'deferred'`; only `active`, `completed`, `dropped`.
- `DeadlineItem.status` is `'active' | 'dropped'` only — no `deferred`, no `completed`.
- `DeadlineItem.date` is `YYYY-MM-DD`, required, never null. Must be in the
  future at the moment it's written (add or edit). Past dates are allowed only
  by passage of time; bucket math hides them.
- `Item.project` references an existing `List.id` or is `null`.
- `created_at` is set once on insert, never edited.
- `id` is set once on insert, never reused, never edited.
- Title is non-empty (whitespace-only rejected).
- `ActionItem.start_at` is only non-null when `status === 'deferred'`. Mutators
  that change status to anything else clear `start_at`.
- `start_at` must be a strictly-future date (`> today` in host local TZ) at the
  moment it's written.

### IDs

8-char nanoids over `[0-9a-zA-Z]`. Generated client-side; multi-device-safe in
practice (no coordination required for uniqueness). Refs in the CLI are the
bare id — no prefix, no colon syntax. `todo show <id>` and lifecycle verbs look
up across both `lists` and `items`.

## CLI surface

13 commands. JSON-only output. Errors are plain text on stderr with non-zero exit.

### Reads

| Command | Returns |
|---|---|
| `todo list` | `{ active_actions, active_projects, deadlines, waiting }` |
| `todo list --all` | also `{ deferred_actions, deferred_projects }` |
| `todo show <id>` | the canonical entity (for projects, also embeds `active_actions`, `deferred_actions`, `waiting`, `deadlines` scoped to the project — regardless of the project's own status) |

**Bucket filters** (compared against host-local `YYYY-MM-DD`):

- `active_actions`: `type=action && parent.active && (status=active || (status=deferred && start_at != null && start_at <= today))`.
- `deferred_actions`: `type=action && status=deferred && (start_at == null || start_at > today) && parent.active` — both open-ended (someday/maybe) and future-scheduled actions.
- `waiting`: `type=waiting && status=active && parent.active`.
- `deadlines`: `type=deadline && status=active && date >= today && parent.active`.
- `active_projects`: `type=project && status=active`.
- `deferred_projects`: `type=project && status=deferred`.

Past-due scheduled items (`start_at <= today`) are auto-promoted into
`active_actions` and excluded from `deferred_actions`. The stored status stays
`deferred` — the dashboard view is the source of effective state.

Children of a deferred or terminal project are hidden from `todo list`. Inspect
them via `todo show <id>` directly. Terminal items, dropped deadlines, and
past-date deadlines are intentionally not surfaced in any list view; query by
id.

### Create

Verb-first: `todo add <type> --title "..." [type-specific flags]`.

```
todo add project  --title "<text>" [--note <text>]
todo add action   --title "<text>" (--active | --deferred | --start <date>)
                                   [--project <id>] [--due <date>] [--note <text>]
todo add waiting  --title "<text>" [--project <id>] [--note <text>]
todo add deadline --title "<text>" --date <date> [--project <id>] [--note <text>]
```

- `add project` creates a `ProjectList` at `status=active`.
- `add action` requires at least one of `--active`, `--deferred`, or `--start
  <date>`. `--start <date>` alone implies `--deferred`. `--active` and
  `--deferred` are mutually exclusive; `--active --start ...` is rejected.
- `--due`, `--start`, and `--date` accept `YYYY-MM-DD` or natural language
  (`tomorrow`, `next friday`). `--start` and `--date` must resolve to a
  strictly-future date; `--start ""` is rejected on `add` (use `edit` to
  clear later).
- `add waiting` creates a `WaitingItem` at `status=active`. No `--due`, no `--start`.
- `add deadline` creates a `DeadlineItem` at `status=active`. `--date` is
  required and must be a future date (today and past dates rejected).
- `--project <id>` must reference an existing project.

### Edit (polymorphic on id)

`todo edit` is the primitive mutation verb. It accepts status flags, the
`--start` schedule flag, and the field flags in any combination.

```
todo edit <id> [--active | --deferred | --completed | --dropped]
              [--start <date>]
              [--title ...] [--note ...] [--due ...] [--project ...] [--date ...]
```

Field semantics:

- Omit a flag to leave the field unchanged.
- Pass `""` to clear: `--note ""`, `--due ""`, `--project ""`, `--start ""`.
- `--title ""` is rejected (title is required).
- `--date ""` is rejected (deadline date is required).
- `--due` is rejected on projects, waiting items, and deadlines.
- `--date` is only valid on deadlines; rejected on projects, actions, and
  waiting items. New value must be a future date.
- `--project` is rejected on projects.
- `--start` is rejected on projects and waiting items.
- `--start <future>` on an action with no explicit status flag implicitly
  transitions `status` to `deferred`. On a terminal action it also clears
  `closed_at` (the schedule overrides the closed state).
- `--start ""` clears `start_at` without changing status.
- Empty patch (no flags) → error: `nothing to edit`.

Status semantics:

- At most one of `--active|--deferred|--completed|--dropped` per call.
- `--active --start ...`, `--completed --start ...`, `--dropped --start ...`
  rejected (contradiction).
- `--deferred --start <future>` is the explicit "schedule" call.
- See the lifecycle effects table below for `closed_at` / `start_at` clearing.

### Lifecycle (polymorphic on id)

Each lifecycle verb is a 1:1 alias for `todo edit <id> --<status>`. Same
validation rules.

```
todo activate <id>                   # ≡ edit <id> --active
todo defer <id> [--start <date>]     # ≡ edit <id> --deferred [--start <date>]
todo complete <id>                   # ≡ edit <id> --completed
todo drop <id>                       # ≡ edit <id> --dropped
```

Lifecycle effects:

| transition | status | closed_at | start_at |
|---|---|---|---|
| `--active` / `activate` | `active` | cleared | cleared |
| `--deferred` (no `--start`) / `defer` | `deferred` | cleared | cleared |
| `--deferred --start <d>` / `defer --start <d>` | `deferred` | cleared | `<d>` |
| `--completed` / `complete` | `completed` | `now` | cleared |
| `--dropped` / `drop` | `dropped` | `now` | cleared |

Entity-type rules:

- `--active` and `--deferred` reject waiting items (waiting has no `deferred`
  state and no resurrection path; terminal waiting items stay terminal).
- `--start` rejects projects, waiting items, and deadlines.
- `complete` and `defer` reject deadlines (deadlines are not tasks; they
  only transition to `dropped`, and `activate` un-drops).
- `activate`/`defer` are also how you bring a completed/dropped action or
  project back to a live state — they clear `closed_at`. There is no
  `reopen` verb.

### Configuration

```
todo set-data-dir <abs-path>     # writes ~/.todo/config.json
todo config                      # prints { dataDir, source }
```

`source` is `"env"`, `"config"`, or `"default"`.

## Output

Every read, mutation, and lifecycle response is a single canonical entity (or a
bucket-of-entities object for the list views). Storage shape and display shape
are identical — what's on disk is what's emitted on stdout. The only "view"
logic is bucketing and filtering for the list views.

Pretty-printed (2-space indent, sorted keys), trailing newline.

## Errors

Plain text on stderr, prefixed with `todo:`, exit code 1.

| Error | Cause |
|---|---|
| `not found: <id>` | unknown nanoid |
| `nothing to edit` | edit with no patch fields |
| `--active or --deferred is required for actions` | `add action` without a status flag |
| `--active and --deferred are mutually exclusive` | both passed to `add action` |
| `--due is not allowed on waiting items` | edit waiting with `--due` |
| `--due is not allowed on deadlines` | edit deadline with `--due` |
| `--due is not allowed on projects` | edit project with `--due` |
| `--date is not allowed on actions` | edit action with `--date` |
| `--date is not allowed on waiting items` | edit waiting with `--date` |
| `--date is not allowed on projects` | edit project with `--date` |
| `--project is not allowed on projects` | edit project with `--project` |
| `unknown project: <id>` | parent ref doesn't resolve |
| `cannot activate waiting item <id> (...)` | `activate`/`defer` on a waiting item |
| `cannot complete deadline <id> (deadlines are not tasks; use drop)` | `complete` on a deadline |
| `cannot defer deadline <id> (deadlines have no deferred state)` | `defer` on a deadline |
| `date is required and cannot be empty` | `edit <deadline-id> --date ""` |
| `date must be in the future: <input>` | `add deadline --date <past-or-today>` or `edit --date <past-or-today>` |
| `data dir must be an absolute path (...)` | relative path in env or config |
| `malformed store.json at ...` | file present but not parseable JSON |
| `could not parse date: <input>` | unparseable `--due`, `--start`, or `--date` |
| `title is required and cannot be empty` | empty title on add or edit |
| `date must be in the future: <input>` | `--start` or deadline `--date` resolves to today or past |
| `--active, --deferred, or --start is required for actions` | `add action` with no mode flag |
| `--start cannot combine with --active` | `add action --active --start ...` |
| `--start requires --deferred` | `edit <id> --active --start ...` |
| `--start is not allowed on projects` | `--start` against a project (defer/edit) |
| `--start is not allowed on waiting items` | `--start` against a waiting item |
| `--start is not allowed with --completed / --dropped` | terminal + schedule contradiction |
| `--start cannot be empty on add` / `... on defer` | `--start ""` on `add action` or `defer` |

## Out of scope

- Migration from any prior format. None exists.
- Multiple data stores / vaults. One data-dir at a time.
- Multi-device merge logic. Single-writer-at-a-time. Nanoids prevent id
  collisions but offline-edit merge of array contents is your problem.
- Status filtering on `todo list` (`--completed` / `--dropped`). Use
  `todo show <id>`.
- Multiple list subtypes. Only `ProjectList` exists today.
- Agenda task type, contexts, tags, situational metadata. Future direction;
  not present.
