# @telepath-computer/todo

A GTD-style task and project CLI with JSON storage. Designed for LLM agents:
JSON-only output, stable refs, predictable shapes. Humans can read it too.

## What it does

Three things go in your todo, in GTD shorthand:

- **Projects** — outcomes that take more than one action. Anything you're
  engaged with: "Telepath", "House move", "Q3 launch". Park them when life
  moves on.
- **Actions** — concrete things to do. The kind you can pick up and finish:
  "email Steve", "buy headphones". They're either *active* (a next action,
  ready to do) or *deferred* (someday/maybe — not now, not gone).
- **Waiting** — things blocking on someone else: "cover art from designer",
  "tax refund". You don't act on these; you watch them.

Anything finishes one of two ways: **completed** (done) or **dropped**
(not happening). For projects and actions you can also flip them between
active and deferred — useful when something heats up or cools off.

The dashboard view (`todo list`) shows what's *live*: the active actions you
could do now, what you're waiting on, and which projects are in motion.
`--all` adds the deferred stuff. Terminal items stay out of the way.

## Install

```sh
npm install -g @telepath-computer/todo
```

The binary is `todo`. `todo --help` lists every command;
`todo <command> --help` describes flags.

## Example

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

$ todo complete K3jLm9pQ          # done
$ todo activate K3jLm9pQ          # changed your mind: bring it back live
```

## Storage

Data lives at `~/.todo/data/store.json`. Override with `TODO_DATA_DIR` or
`todo set-data-dir <abs-path>` (writes `~/.todo/config.json`). The store is
pretty-printed JSON with sorted keys — safe to commit, sync, or hand-edit.
Single writer at a time.

## Docs

- [docs/spec.md](docs/spec.md) — full schema, CLI surface, error catalog.
- [docs/architecture.md](docs/architecture.md) — implementation notes.

## License

MIT.
