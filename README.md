# @telepath-computer/todo

A GTD-style task and project CLI with JSON storage. Designed for LLM agents:
discriminated entity types, stable nanoid refs, JSON-only output. Humans can
read it too.

## Install

```sh
npm install -g @telepath-computer/todo
```

The binary is `todo`.

## Concepts

Three entity types, all stored together in one JSON file:

| Type | When to use | Status values |
|---|---|---|
| **project** | A multi-action outcome you're engaged with (or paused on). | active ↔ deferred → completed / dropped |
| **action** | A concrete next action you can do. | active (next) ↔ deferred (someday/maybe) → completed / dropped |
| **waiting** | Something you're waiting on someone else for. | active → completed / dropped (no resurrection) |

Every entity gets a stable 8-char nanoid (e.g. `Vh8XLm2k`). IDs never shift on
mutation and are never reused. Every command that takes `<id>` accepts any
entity id; the CLI looks up across projects and items.

Each entity has `status` (one of `active`, `deferred`, `completed`, `dropped` —
waiting items can't be `deferred`) and `closed_at` (ISO timestamp; non-null
iff status is completed or dropped).

## Storage

```
~/.todo/
├── config.json        # CLI config (data-dir override)
└── data/
    └── store.json     # all data
```

The data directory resolves in this order:

1. `TODO_DATA_DIR` environment variable
2. `dataDir` in `~/.todo/config.json` (set via `todo set-data-dir`)
3. Default `~/.todo/data/`

Paths must be absolute. Relative paths are rejected with a clear error.

`store.json` is pretty-printed with sorted keys, atomic-written via tmpfile +
rename — safe to commit, sync via Dropbox/iCloud, or hand-edit.

## CLI

12 commands, JSON-only output. Errors go to stderr with non-zero exit.

### Reads

```
todo list                 # { active_actions, waiting, active_projects }
todo list --all           # also { deferred_actions, deferred_projects }
todo show <id>            # full canonical entity
```

### Create (verb-first)

```
todo add project --title "..." [--note <text>]
todo add action  --title "..." (--active | --deferred) [--project <id>] [--due <date>] [--note <text>]
todo add waiting --title "..." [--project <id>] [--note <text>]
```

`--due` accepts `YYYY-MM-DD` or natural language (`tomorrow`, `next friday`).

### Edit (polymorphic on id)

```
todo edit <id> [--title ...] [--note ...] [--due ...] [--project ...]
```

Pass `""` to clear an optional field. `--due` is rejected on projects and
waiting items. `--project` is rejected on projects.

### Lifecycle (polymorphic on id)

```
todo activate <id>        # status=active;    clears closed_at
todo defer <id>           # status=deferred;  clears closed_at
todo complete <id>        # status=completed; closed_at=now
todo drop <id>            # status=dropped;   closed_at=now
```

`activate`/`defer` reject waiting items (waiting has no `deferred` state and
no resurrection path). To bring a completed/dropped action or project back to
a live state, use `activate` or `defer` — both clear the terminal fields.

### Configuration

```
todo set-data-dir <abs-path>     # writes ~/.todo/config.json
todo config                      # prints { dataDir, source }
```

## Example

```
$ todo add project --title "Telepath" --note "Indie tool"
{
  "closed_at": null,
  "created_at": "2026-04-27T11:10:00Z",
  "id": "Vh8XLm2k",
  "note": "Indie tool",
  "status": "active",
  "title": "Telepath",
  "type": "project"
}

$ todo add action --title "Find guests" --active --project Vh8XLm2k --due tomorrow
{
  "closed_at": null,
  "created_at": "2026-04-27T11:11:00Z",
  "due": "2026-04-28",
  "id": "K3jLm9pQ",
  "note": null,
  "project": "Vh8XLm2k",
  "status": "active",
  "title": "Find guests",
  "type": "action"
}

$ todo list
{
  "active_actions": [ ... ],
  "active_projects": [ ... ],
  "waiting": []
}
```

## Docs

- [docs/spec.md](docs/spec.md) — entity schema, storage layout, CLI surface, semantics.
- [docs/architecture.md](docs/architecture.md) — implementation notes (modules, layer rules, conventions).

## License

MIT.
