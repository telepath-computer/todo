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
      "active": true,
      "completed": null,
      "created": "2026-04-27T10:14:00Z",
      "dropped": null,
      "id": "Vh8XLm2k",
      "note": "Indie thinking tool.",
      "title": "Telepath",
      "type": "project"
    }
  ],
  "items": [
    {
      "active": true,
      "completed": null,
      "created": "2026-04-27T10:14:32Z",
      "due": "2026-05-01",
      "dropped": null,
      "id": "K3jLm9pQ",
      "list": "Vh8XLm2k",
      "note": null,
      "title": "Find guests",
      "type": "action"
    }
  ]
}
```

## Schema

Discriminated subtypes — each entity carries only the fields it actually has.

```typescript
type BaseList = {
  id: string                   // 8-char nanoid
  title: string                // non-empty
  note: string | null
  created: string              // ISO 8601, set on insert, never edited
}

type ProjectList = BaseList & {
  type: 'project'
  active: boolean              // false = deferred (paused)
  completed: string | null     // ISO; mutually exclusive with dropped
  dropped: string | null
}

type List = ProjectList         // future: more list subtypes

type BaseItem = {
  id: string
  list: string | null          // parent project id; null = standalone
  title: string
  note: string | null
  created: string
}

type ActionItem = BaseItem & {
  type: 'action'
  active: boolean              // false = deferred (someday/maybe)
  due: string | null           // YYYY-MM-DD
  completed: string | null
  dropped: string | null
}

type WaitingItem = BaseItem & {
  type: 'waiting'
  completed: string | null
  dropped: string | null
}

type Item = ActionItem | WaitingItem

type Store = { lists: List[]; items: Item[] }
```

### Invariants

- `completed` and `dropped` are mutually exclusive: at most one is non-null.
- `WaitingItem` has no `active` flag; it's either live or terminal.
- `Item.list` references an existing `List.id` or is `null`.
- `created` is set once on insert, never edited.
- `id` is set once on insert, never reused, never edited.
- Title is non-empty (whitespace-only rejected).

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
| `todo list` | `{ active_actions, waiting, active_projects }` |
| `todo list --all` | also `{ deferred_actions, deferred_projects }` |
| `todo projects list` | `{ active_projects, deferred_projects }` |
| `todo show <id>` | the canonical entity |

**Bucket filters:**

- `active_actions`: `type=action && active=true && !terminal && parent.active=true` (or no parent).
- `deferred_actions`: `active=false && !terminal && parent.active=true`.
- `waiting`: `type=waiting && !terminal && parent.active=true`.
- `active_projects`: `type=project && active=true && !terminal`.
- `deferred_projects`: `type=project && active=false && !terminal`.

Children of a deferred or terminal project are hidden from `todo list`. Inspect
them via `todo show <id>` directly. Terminal items are intentionally not
surfaced in any list view; query by id.

### Item creation

```
todo add "<title>" (--active | --deferred | --waiting)
                   [--project <id>] [--due <date>] [--note <text>]
```

- Exactly one of `--active`, `--deferred`, `--waiting` is required.
- `--active` / `--deferred` create an `ActionItem` with `active` set accordingly.
- `--waiting` creates a `WaitingItem`. `--due` is rejected.
- `--due` accepts `YYYY-MM-DD` or natural language (`tomorrow`, `next friday`).
- `--project <id>` must reference an existing project.

### Item edit

```
todo edit <id> [--title ...] [--note ...] [--due ...] [--project ...]
```

- Omit a flag to leave the field unchanged.
- Pass `""` to clear: `--note ""`, `--due ""`, `--project ""`.
- `--title ""` is rejected (title is required).
- `--due ""` and `--due <date>` are rejected on waiting items.
- Empty patch (no flags) → error: `nothing to edit`.

### Project creation / edit

```
todo projects add --title "<text>" [--note <text>]
todo projects edit <id> [--title ...] [--note ...]
```

Same `""` clearing convention applies to `--note`.

### Lifecycle

Polymorphic on `<id>` — accepts any project, action, or waiting id.

```
todo activate <id>     # active=true, completed=null, dropped=null
todo defer <id>        # active=false, completed=null, dropped=null
todo complete <id>     # completed=now, dropped=null
todo drop <id>         # dropped=now, completed=null
```

- `activate` and `defer` reject waiting items (no `active` flag).
- `activate`/`defer` are also how you bring a completed/dropped action or
  project back to a live state — they clear the terminal fields. There is no
  `reopen` verb.
- Waiting items have no resurrection path. Once terminal, they stay terminal;
  to track a fresh ask, create a new waiting item.

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
| `--active, --deferred, or --waiting is required` | mode flag missing on `add` |
| `--active, --deferred, --waiting are mutually exclusive (got N)` | multiple modes |
| `--due is not allowed on waiting items` | waiting + `--due` |
| `unknown project: <id>` | parent ref doesn't resolve |
| `cannot activate waiting item <id> (no active flag)` | waiting + `activate`/`defer` |
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
