# @telepath-computer/todo

A GTD-style task and project CLI with JSON storage. Designed for LLM agents:
JSON-only output, stable nanoid refs, discriminated entity types. Humans can
read it too.

## Install

```sh
npm install -g @telepath-computer/todo
```

The binary is `todo`. Data lives at `~/.todo/data/store.json` by default —
override with `TODO_DATA_DIR=/abs/path` or `todo set-data-dir /abs/path`.

## Example session

```sh
$ todo add project --title "Telepath" --note "Indie thinking tool"
{
  "closed_at": null,
  "created_at": "2026-04-27T11:10:00Z",
  "id": "Vh8XLm2k",
  "note": "Indie thinking tool",
  "status": "active",
  "title": "Telepath",
  "type": "project"
}

$ todo add action --title "Find guests for E14" --active --project Vh8XLm2k --due tomorrow
{
  "closed_at": null,
  "created_at": "2026-04-27T11:11:00Z",
  "due": "2026-04-28",
  "id": "K3jLm9pQ",
  "note": null,
  "project": "Vh8XLm2k",
  "status": "active",
  "title": "Find guests for E14",
  "type": "action"
}

$ todo add waiting --title "Cover art from designer" --project Vh8XLm2k

$ todo list
{
  "active_actions":  [ ... ],
  "active_projects": [ ... ],
  "waiting":         [ ... ]
}

$ todo complete K3jLm9pQ          # status=completed, closed_at=now
$ todo activate K3jLm9pQ          # bring it back: status=active, closed_at=null
```

`todo --help` lists every command; `todo <command> --help` describes flags.

## What it does

Three entity types share one JSON store:

- **project** — a multi-action outcome. Active, deferred (paused), or terminal.
- **action** — a doable next action. Active (next), deferred (someday), or terminal.
- **waiting** — something you're waiting on someone else for. Active or terminal.

Every entity has a stable 8-char nanoid (`Vh8XLm2k`) — IDs never shift on
mutation and are never reused. Every command that takes `<id>` accepts any
entity id; the CLI resolves polymorphically.

Status: `active | deferred | completed | dropped` (waiting items can't be
deferred). `closed_at` is non-null iff the entity is `completed` or `dropped`.

## Storage

`store.json` is pretty-printed with sorted keys and atomic-written via tmpfile
+ rename — safe to commit, sync (Dropbox, iCloud), or hand-edit. Single writer
at a time.

Config lives at `~/.todo/config.json`. Path resolution order:
`TODO_DATA_DIR` env var → `dataDir` in config → default `~/.todo/data/`.
Paths must be absolute.

## Docs

- [docs/spec.md](docs/spec.md) — entity schema, CLI surface, error catalog.
- [docs/architecture.md](docs/architecture.md) — implementation notes.

## License

MIT.
