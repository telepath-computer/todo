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

| Type | When to use | Lifecycle |
|---|---|---|
| **project** | A multi-action outcome you're engaged with (or paused on). | active ↔ deferred → completed / dropped |
| **action** | A concrete next action you can do. | active (next) ↔ deferred (someday/maybe) → completed / dropped |
| **waiting** | Something you're waiting on someone else for. | live → completed / dropped (no resurrection) |

Every entity gets a stable 8-char nanoid (e.g. `Vh8XLm2k`). IDs never shift on
mutation and are never reused. Every command that takes `<id>` accepts any
entity id; the CLI looks up across projects and items.

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

13 commands, JSON-only output. Errors go to stderr with non-zero exit.

### Reads

```
todo list                 # { active_actions, waiting, active_projects }
todo list --all           # also { deferred_actions, deferred_projects }
todo projects list        # { active_projects, deferred_projects }
todo show <id>            # full canonical entity
```

### Item creation

```
todo add "<title>" --active   [--project <id>] [--due <date>] [--note <text>]
todo add "<title>" --deferred [--project <id>] [--due <date>] [--note <text>]
todo add "<title>" --waiting  [--project <id>] [--note <text>]
```

Exactly one of `--active`, `--deferred`, `--waiting` is required.
`--due` accepts `YYYY-MM-DD` or natural language (`tomorrow`, `next friday`).

### Item edit

```
todo edit <id> [--title ...] [--note ...] [--due ...] [--project ...]
```

Pass `""` to clear an optional field: `--note ""`, `--due ""`, `--project ""`.
`--due` is rejected on waiting items.

### Project creation / edit

```
todo projects add --title "<text>" [--note <text>]
todo projects edit <id> [--title ...] [--note ...]
```

### Lifecycle (polymorphic on id)

```
todo activate <id>        # active=true; clears completed/dropped
todo defer <id>           # active=false; clears completed/dropped
todo complete <id>        # completed=now, dropped=null
todo drop <id>            # dropped=now, completed=null
```

`activate`/`defer` reject waiting items (no `active` flag). To bring a
completed/dropped action or project back to a live state, use `activate` or
`defer` — both clear the terminal fields. There is no `reopen` verb.

### Configuration

```
todo set-data-dir <abs-path>     # writes ~/.todo/config.json
todo config                      # prints { dataDir, source }
```

## Example

```
$ todo projects add --title "Telepath" --note "Indie tool"
{
  "active": true,
  "completed": null,
  "created": "2026-04-27T11:10:00Z",
  "dropped": null,
  "id": "Vh8XLm2k",
  "note": "Indie tool",
  "title": "Telepath",
  "type": "project"
}

$ todo add "Find guests" --active --project Vh8XLm2k --due tomorrow
{
  "active": true,
  "completed": null,
  "created": "2026-04-27T11:11:00Z",
  "due": "2026-04-28",
  "dropped": null,
  "id": "K3jLm9pQ",
  "list": "Vh8XLm2k",
  "note": null,
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
- [skill/SKILL.md](skill/SKILL.md) — agent-facing usage guide.

## License

MIT.
