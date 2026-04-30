# @telepath-computer/todo

A GTD-style task and project CLI. Designed for LLM agents: read commands
emit YAML-like `key: value` blocks (with a `HINTS:` section surfacing what
the dashboard hides); mutation commands return canonical entity JSON.
Humans can read it too. Stable nanoid refs throughout.

## What it does

Five things go in your todo, in GTD shorthand:

- **Projects** — outcomes that take more than one action. Anything you're
  engaged with: "Telepath", "House move", "Q3 launch". Park them when life
  moves on.
- **Actions** — concrete things to do. The kind you can pick up and finish:
  "email Steve", "buy headphones". They're either *active* (a next action,
  ready to do) or *deferred* (someday/maybe — not now, not gone). A deferred
  action can carry an optional **start date** to schedule it: it stays out of
  the way until that day, then auto-shows on the dashboard.
- **Waiting** — things blocking on someone else: "cover art from designer",
  "tax refund". You don't act on these; you watch them.
- **Deadlines** — date markers, not tasks: "Q3 launch", "visa expires",
  "tax filing day". They show on the dashboard until the date passes, then
  silently disappear. You can `drop` one if it's cancelled, but you can't
  "complete" it — a deadline is a fact about time.
- **Memos** — free-standing notes and facts worth keeping around:
  "Sam is in hospital", "ask about budget cap", "printer model is HP 4101".
  Give them an optional start date when they should stay off the daily
  dashboard until later; the full set resurfaces on `todo review`.

Tasks (actions, projects) finish one of two ways: **completed** (done) or
**dropped** (not happening). For projects and actions you can flip them
between active and deferred too. Deadlines only `drop` (and `activate`
un-drops); the date passing is what retires them.

The dashboard (`todo` with no subcommand) shows what's *live*: active
actions, waiting items, upcoming deadlines, active projects, and
available memos under `KEEP IN MIND` at the bottom — plus a `HINTS:`
section flagging stuff the dashboard would otherwise hide (recent
lapsed deadlines, stalled projects, stale waiting, deferred queue
size). Terminal items, dropped deadlines, past-date deadlines, and
future-dated memos stay out of the way; reach them with
`todo list <type>` or `todo review`.

## Install

```sh
npm install -g @telepath-computer/todo
```

The binary is `todo`. `todo --help` lists every command;
`todo <command> --help` describes flags.

## Example

```sh
$ todo add project "Telepath" --note "Indie thinking tool"
{
  "closed_at": null,
  "created_at": "2026-04-27T11:10:00Z",
  "id": "Vh8XLm2k",
  "note": "Indie thinking tool",
  "status": "active",
  "title": "Telepath",
  "type": "project"
}

$ todo add action "Find guests for E14" --active --project Vh8XLm2k --due tomorrow
{
  "closed_at": null,
  "created_at": "2026-04-27T11:11:00Z",
  "due": "2026-04-28",
  "id": "K3jLm9pQ",
  "note": null,
  "project": "Vh8XLm2k",
  "start_at": null,
  "status": "active",
  "title": "Find guests for E14",
  "type": "action"
}

$ todo add action "Renew domain" --deferred --start "next monday"
# scheduled — hidden from the dashboard until that day, then auto-shows

$ todo add waiting "Cover art from designer" --project Vh8XLm2k

$ todo add deadline "Q3 launch" --date "next quarter end" --project Vh8XLm2k

$ todo add memo "Vacation starts Monday" --start "next monday"
# hidden from the daily dashboard until that date; still visible in `todo review`

$ todo add memo "Sam is in hospital"

$ todo
ACTIVE ACTIONS [1]:

- id: K3jLm9pQ
  title: "Find guests for E14"
  due: 2026-04-28 (tomorrow)
  project: Telepath [Vh8XLm2k]

WAITING [1]:

- id: pq3LmXyZ
  title: "Cover art from designer"
  project: Telepath [Vh8XLm2k]
  age: 0 days

DEADLINES [1]:
... etc.

ACTIVE PROJECTS [1]:
... etc.

KEEP IN MIND [1]:

- id: a1b2C3d4
  note: "Sam is in hospital"

$ todo review
MEMOS [1]:

- id: a1b2C3d4
  note: "Sam is in hospital"

$ todo complete K3jLm9pQ          # done
$ todo activate K3jLm9pQ          # changed your mind: bring it back live
```

## Storage

Data lives at `~/.todo/data/store.json`. Override with `TODO_DATA_DIR` or
`todo config data_dir <abs-path>` (writes `~/.todo/config.json`). The store is
pretty-printed JSON with sorted keys — safe to commit, sync, or hand-edit.
Single writer at a time.

## Docs

- [docs/spec.md](docs/spec.md) — full schema, CLI surface, error catalog.
- [docs/architecture.md](docs/architecture.md) — implementation notes.

## License

MIT.
