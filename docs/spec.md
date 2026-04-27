# todo — spec

JSON-storage CLI for GTD-style projects, actions, and waiting items. Agent-first;
JSON-only output.

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
  closed_at: string | null
}

type WaitingItem = BaseItem & {
  type: 'waiting'
  status: WaitingStatus        // no 'deferred' for waiting
  closed_at: string | null
}

type Item = ActionItem | WaitingItem

type Store = { lists: List[]; items: Item[] }
```

### Invariants

- `closed_at` is non-null iff `status` is `completed` or `dropped`.
- `WaitingItem.status` excludes `'deferred'`; only `active`, `completed`, `dropped`.
- `Item.project` references an existing `List.id` or is `null`.
- `created_at` is set once on insert, never edited.
- `id` is set once on insert, never reused, never edited.
- Title is non-empty (whitespace-only rejected).

### IDs

8-char nanoids over `[0-9a-zA-Z]`. Generated client-side; multi-device-safe in
practice (no coordination required for uniqueness). Refs in the CLI are the
bare id — no prefix, no colon syntax. `todo show <id>` and lifecycle verbs look
up across both `lists` and `items`.

## CLI surface

12 commands. JSON-only output. Errors are plain text on stderr with non-zero exit.

### Reads

| Command | Returns |
|---|---|
| `todo list` | `{ active_actions, waiting, active_projects }` |
| `todo list --all` | also `{ deferred_actions, deferred_projects }` |
| `todo show <id>` | the canonical entity |

**Bucket filters:**

- `active_actions`: `type=action && status=active && parent.status=active` (or no parent).
- `deferred_actions`: `status=deferred && parent.status=active` (or no parent).
- `waiting`: `type=waiting && status=active && parent.status=active` (or no parent).
- `active_projects`: `type=project && status=active`.
- `deferred_projects`: `type=project && status=deferred`.

Children of a deferred or terminal project are hidden from `todo list`. Inspect
them via `todo show <id>` directly. Terminal items are intentionally not
surfaced in any list view; query by id.

### Create

Verb-first: `todo add <type> --title "..." [type-specific flags]`.

```
todo add project --title "<text>" [--note <text>]
todo add action  --title "<text>" (--active | --deferred)
                                  [--project <id>] [--due <date>] [--note <text>]
todo add waiting --title "<text>" [--project <id>] [--note <text>]
```

- `add project` creates a `ProjectList` at `status=active`.
- `add action` requires exactly one of `--active` / `--deferred`. `--due`
  accepts `YYYY-MM-DD` or natural language (`tomorrow`, `next friday`).
- `add waiting` creates a `WaitingItem` at `status=active`. No `--due`.
- `--project <id>` must reference an existing project.

### Edit (polymorphic on id)

```
todo edit <id> [--title ...] [--note ...] [--due ...] [--project ...]
```

- Omit a flag to leave the field unchanged.
- Pass `""` to clear: `--note ""`, `--due ""`, `--project ""`.
- `--title ""` is rejected (title is required).
- `--due` is rejected on projects and waiting items.
- `--project` is rejected on projects.
- Empty patch (no flags) → error: `nothing to edit`.

### Lifecycle (polymorphic on id)

```
todo activate <id>     # status=active,    closed_at=null
todo defer <id>        # status=deferred,  closed_at=null
todo complete <id>     # status=completed, closed_at=now
todo drop <id>         # status=dropped,   closed_at=now
```

- `activate` and `defer` reject waiting items (waiting has no `deferred`
  state and no resurrection path; terminal waiting items stay terminal).
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
| `--due is not allowed on projects` | edit project with `--due` |
| `--project is not allowed on projects` | edit project with `--project` |
| `unknown project: <id>` | parent ref doesn't resolve |
| `cannot activate waiting item <id> (...)` | `activate`/`defer` on a waiting item |
| `data dir must be an absolute path (...)` | relative path in env or config |
| `malformed store.json at ...` | file present but not parseable JSON |
| `could not parse date: <input>` | unparseable `--due` |
| `title is required and cannot be empty` | empty title on add or edit |

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
