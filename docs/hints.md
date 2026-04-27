# Hints

`todo` (the dashboard) ends with a `# Hints` section when one of these
conditions fires. Hints are the place where the GTD-filtering blind spots
get surfaced — facts the dashboard would otherwise hide.

Each hint is grounded in a specific data condition. When nothing fires the
section is omitted entirely (no filler).

## v1 catalog

### 1. Recent lapsed deadlines

**Condition.** Any `type='deadline'` item with `status='active'` AND
`date < today` AND `(today - date) <= 7 days`.

**Why.** Deadlines are *made to lapse* — that's how they end. There is no
"completed" state. But a recent lapse can pass unnoticed if the user
hasn't checked the dashboard since the date passed. Surface it once so the
agent confirms the user grokked it, then drops it.

**Format.**
```
- (id) <title> deadline passed N days ago. Confirm with the user it's grokked, then `todo drop <id>`.
```

Older lapsed-but-still-active deadlines (>7 days) are not surfaced. They
become user housekeeping; the agent doesn't keep nagging.

### 2. Stalled active projects

**Condition.** Any `type='project'` item with `status='active'`, zero
active actions (mirrors `liveActions`-style: `status='active'` OR
`status='deferred'` with past-due `start_at`), and at least one item
attached to it (so we don't flag just-created empty projects).

**Why.** GTD says every active project should have a next action. If it
doesn't, it's either blocked on a waiting item, missing a next action, or
quietly stalled. The agent doesn't know to enforce that without being told.

**Format.**
```
- (id) <Title>: no active actions, <N> waiting, <M> deadlines. Either blocked on a waiting item, needs a next action defined, or consider `todo defer <id>`.
```

### 3. Stale waiting

**Condition.** Any `type='waiting'` item with `status='active'` whose age
(now − `created_at`, in local-day terms) is greater than 7 days.

**Why.** Waiting items are blocked on someone else, but sometimes you
forget you're waiting — designer ghosted you, refund delayed, vendor
dragging. After a week it's worth a poke.

**Format (one bullet per stale item).**
```
- (id) <title> waiting N days. Worth a follow-up?
```

### 4. Long-tail deferred count

**Condition.** Total deferred items (deferred actions + deferred projects,
counted via the same bucket math the dashboard uses) > 0.

**Why.** An agent that hasn't enumerated `list actions` / `list projects`
doesn't know how big the someday/maybe queue is. One line, informational.

**Format.**
```
- N deferred items hidden. `todo list actions` / `todo list projects` to inspect.
```

## Ordering

Bullets within `# Hints` appear in this fixed order:

1. Recent lapsed deadlines (most likely to need a response).
2. Stalled active projects.
3. Stale waiting items.
4. Long-tail deferred count (informational, last).

## Where this lives in code

- `src/core/hints.ts` — one function per trigger plus a `renderHints`
  composer. Pure functions; no I/O.
- `src/core/render.ts` — the `renderDashboard` and `renderShow` (project
  case) call into `renderHints` and append the section if non-empty.

## Why not more triggers?

The plan resisted starting with a big catalog. The four above all encode
either a silent-failure case (recent lapsed deadline) or a GTD-philosophy
rule the data alone doesn't say (stalled project, stale waiting, long
tail). Anything else should earn its place via real usage rather than
guessing in the abstract. Out-of-scope for v1: heads-ups about
soon-to-revive scheduled actions (the schedule mechanism is the heads-up),
and "last activity" / recency hints (no clear action for the agent to
take).
