# Plan: narrative output + Hints + bare-todo dashboard

## Goal

Flip the default output of read commands from pure JSON to markdown-ish
narrative. Add a `# Hints` section that surfaces shoulds the dashboard's
GTD filtering hides — kept narrow: only signal, no wallpaper. Make the
bare `todo` invocation (no subcommand) the central-control dashboard.
Replace `todo list` (the old JSON enumeration of buckets) with `todo
list <type>` for flat enumeration. Mutation responses (add / edit /
lifecycle) stay as canonical entity JSON. No `--json` flag in v1; add
later if real tooling needs it.

This is an interface for an agent. Agents read narrative as well as JSON
(better for context inclusion), and benefit from being *coached* about
hidden state — not just handed a filtered enumeration. The bare `todo`
invocation is the agent's entry point: run it to orient.

## Command surface

| command | role |
|---|---|
| `todo` | coached dashboard (live items + Hints). The default action. |
| `todo list <type>` | flat enumeration of every item of that type, regardless of status. `<type>` ∈ `actions`, `projects`, `deadlines`, `waiting`. No filters in v1. |
| `todo show <id>` | drill into one entity. Project shows embedded children. |
| `todo add <type>`, `edit <id>`, lifecycle verbs, `set-data-dir`, `config` | unchanged. |
| `todo --help` | help. |

## Output format

### `todo` (bare invocation)

The dashboard. Default action when invoked with no subcommand.

```
# Active actions (3)
- (K3jLm9pQ) Find guests for E14 — due 2026-04-28 (in 1 day), project Telepath (Vh8XLm2k)
- (M2A4Bk7q) Email Steve — note: "follow up on contract"
- (Q9LnRr2T) Buy headphones

# Waiting (1)
- (W3jKlmnP) Cover art from designer — project Telepath (Vh8XLm2k), waiting 12 days

# Deadlines (1)
- (IbtKycix) Q3 launch — 2026-11-12 (in 199 days), project Telepath (Vh8XLm2k)

# Active projects (1)
- (Vh8XLm2k) Telepath — 3 actions, 1 waiting, 1 deadline

# Hints
- (Mn5pHj2k) Tax filing day deadline passed 4 days ago. Confirm with the user it's grokked, then `todo drop Mn5pHj2k`.
- (Rd9XmKpL) Telepath: no active actions, but 1 waiting and 1 deadline. Either blocked on the waiting, needs a next action defined, or consider deferring with `todo defer Rd9XmKpL`.
- (Wq3J7m2P) Cover art from designer waiting 9 days. Worth a follow-up?
- 287 deferred items hidden. `todo list --all` to inspect (someday/maybe + future-scheduled).
```

Empty buckets are **omitted entirely** (no `# Deadlines (0)` heading).

The dashboard does **not** include deferred items. Use `todo list actions`
or `todo list projects` to enumerate everything (including deferred and
terminal). The dashboard stays focused.

### `todo list <type>`

Flat enumeration. `<type>` ∈ `actions`, `projects`, `deadlines`, `waiting`.
Returns every item of that type, regardless of status — this is how you
reach completed/dropped/past-date items that `status` filters out. No
filter flags in v1.

```
$ todo list actions
# Actions (28)
- (K3jLm9pQ) Find guests for E14 — due 2026-04-28 (in 1 day), project Telepath, status active
- (M2A4Bk7q) Email Steve — note: "follow up on contract", status active
- (R7uXm2Pq) Episode E15 outline — project Telepath, status deferred
- (D2pNxYz8) Old onboarding follow-ups — project Onboarding, status completed, closed 2026-03-12T...
- ...
```

**No Hints section** in `list` output. This is enumeration, not coaching.

Item line format is the same as `status`, with two extra modifiers always
appended for context (since status is no longer implied by the bucket):
`status <s>`, and `closed <timestamp>` for terminal items.

### `todo show <id>`

For non-projects (action, waiting, deadline): single-block heading + key facts.

```
# Action — Find guests for E14 (K3jLm9pQ)
- Status: active
- Due: 2026-04-28 (in 1 day)
- Project: Telepath (Vh8XLm2k)
- Created: 2026-04-27T11:11:00Z
- Note: (none)
```

For projects: project header at `#`, internal buckets at `##`, scoped to
the project. Plus `## Hints` if anything fires.

```
# Project — Telepath (Vh8XLm2k)
- Status: active
- Note: Indie thinking tool

## Active actions (3)
- (K3jLm9pQ) Find guests for E14 — due 2026-04-28 (in 1 day)
- ...

## Deferred actions (1)
- (R7uXm2Pq) Episode E15 outline

## Waiting (1)
- (W3jKlmnP) Cover art from designer — waiting 12 days

## Deadlines (1)
- (IbtKycix) Q3 launch — 2026-11-12 (in 199 days)

## Hints
- No active actions for 14 days. Either blocked on the waiting (W3jKlmnP), needs a next action defined, or consider `todo defer Vh8XLm2k`.
```

### Mutation responses

**Unchanged.** `add`, `edit`, lifecycle verbs, `set-data-dir`, `config` all
return canonical entity JSON.

## Item line format

`- (id) title — modifier1, modifier2, ...`

- `(id)` mandatory and leading. Stable, grep-friendly token.
- Title verbatim (no truncation).
- ` — ` separator.
- Modifiers comma-separated, in this order:
  - `due <YYYY-MM-DD> (<rel>)` — actions only. `<rel>` is one of `today`,
    `tomorrow`, `in N days`, `overdue N days`.
  - `start <YYYY-MM-DD> (<rel>)` — actions only when set. `<rel>` is
    `revives in N days` for future, `revived N days ago` for past.
  - `date <YYYY-MM-DD> (<rel>)` — deadlines. Same rel grammar as `due`.
  - `project <Title> (<id>)` — when item has a parent.
  - `waiting N days` — waiting items.
  - `note: "<truncated>"` — when note present, truncated to ~150 chars at
    soft word boundary, append `…`.

Order: temporal facts first, then context, then state, then note last.

For projects in `# Active projects`: counts modifier
`<N> actions, <M> waiting, <K> deadlines`. Skip zero counts.

## Hints (v1 trigger catalog)

The detailed catalog with conditions, exact output strings, and rationale
lives in **`docs/hints.md`**. That's the source of truth for what fires
when. v1 ships these four:

### 1. Recent lapsed deadlines

Condition: `type='deadline'` AND `status='active'` AND `date < today` AND
`(today - date) <= 7 days`.

Why: deadlines are *made to lapse* — that's how they end. There's no
"complete" state. But for an agent that hasn't talked with the user in a
while, a recent lapse might pass unnoticed. One bullet per recent lapse,
prompting the agent to confirm-then-drop. Older lapses (>7 days, still
active) are user housekeeping; we don't keep nagging.

Output:
```
- (id) <title> deadline passed N days ago. Confirm with the user it's grokked, then `todo drop <id>`.
```

### 2. Stalled active projects

Condition: `type='project'` AND `status='active'` AND zero `liveActions`
filtered to that project AND project has at least one item attached
(don't flag just-created empty projects).

Why: GTD says every active project should have a next action. The agent
doesn't know to enforce that. Suggest the user either define a next action
or defer the project (someday/maybe).

Output:
```
- (id) <Title>: no active actions, <N> waiting, <M> deadlines. Either blocked on a waiting item, needs a next action defined, or consider `todo defer <id>`.
```

### 3. Stale waiting

Condition: `type='waiting'` AND `status='active'` AND `(today - created_at) > 7 days`.

Why: waiting items are blocked on someone else, not your job to do. But
sometimes you forget you're waiting — designer ghosted, refund delayed,
vendor dragging. After a week it's worth a poke.

Output (one bullet per stale item):
```
- (id) <title> waiting N days. Worth a follow-up?
```

### 4. Long-tail deferred count

Condition: total deferred items (actions + projects) > 0.

Why: an agent that hasn't called `--all` doesn't know how big the
someday/maybe queue is. One line, informational. Always present (not
threshold-gated) — even "5 deferred items" is useful calibration.

Output:
```
- N deferred items hidden. `todo list --all` to inspect (someday/maybe + future-scheduled).
```

### Empty hints

If none fire (rare, but possible on a fresh store), omit the `# Hints`
heading entirely. No filler.

### Hint ordering within the section

Hardcoded in `renderHints`:
1. Recent lapsed deadlines (most likely to need surfacing).
2. Stalled active projects.
3. Stale waiting.
4. Deferred count (informational, last).

## Inline modifiers (no Hint needed)

Things visible on the dashboard get annotated on the line, not promoted
to Hints:

- Overdue actions → `due <date> (overdue N days)` on the action line.
- Deadlines / due dates within N days → `(in N days)`, `(today)`,
  `(tomorrow)` modifiers.
- Just-revived scheduled actions → no annotation needed; they appear
  naturally in `active_actions` per `start_at`-bridge bucket math.

The whole point of `start_at` is that the system surfaces it at the right
time. No "heads up" advice needed.

## Code changes

### New module: `src/core/render.ts`

Pure functions; no I/O. Single home for all narrative formatting.

```typescript
export function renderList(s: Store, today: string, opts: { all?: boolean }): string
export function renderShow(s: Store, today: string, entity: List | Item): string
```

Internal:
- `renderItemLine(i: Item, s: Store, today: string): string`
- `renderProjectLine(p: ProjectList, s: Store, today: string): string`
- `relativeDays(date: string, today: string): string`
- `truncateNote(note: string, maxLen = 150): string`

### New module: `src/core/hints.ts`

Pure functions. Each hint is a separate function returning `string[]`
(zero or more bullets). Single composer assembles them in order.

```typescript
export function recentLapsedDeadlines(s: Store, today: string): string[]
export function stalledActiveProjects(s: Store, today: string): string[]
export function staleWaiting(s: Store, today: string): string[]
export function deferredCount(s: Store): string[]   // returns 0 or 1 bullet
export function renderHints(s: Store, today: string): string  // composes all of the above; '' if empty
```

### `src/core/model.ts`

Add helpers used by hints:
- `lapsedDeadlines(s, today)` — `status='active' && date < today` (no parent filter — even orphan/under-deferred-project lapsed deadlines should still be flagged).
- Optional helper `daysBetween(a: string, b: string): number` — pure date-string arithmetic. (Or live in `dates.ts`.)

### `src/commands/dashboard.ts` (new) and `src/commands/list.ts` (rewritten)

- `dashboard.ts` — coached dashboard. Output via `renderDashboard(store, today)`.
  Wired in `cli.ts` as the program's default action (no subcommand).
- `list.ts` — flat enumeration. Replaces the old list command. Routes by
  `<type>` arg and renders via `renderList(items, type)`. No filter flags
  in v1.

### `src/commands/show.ts`

Replace JSON path with `renderShow(store, today, entity)` call. The existing
`entity.type === 'project'` branch becomes the project-show renderer path.

### `src/cli.ts`

- Remove the existing `list` command (currently the dashboard JSON path).
- Set `program.action(...)` so a bare `todo` invocation runs the dashboard.
  Bare command no longer prints help; for help, use `todo --help`.
- Add new `list <type>` command. `<type>` ∈ `actions`, `projects`,
  `deadlines`, `waiting`.

Renderer module exports:
```typescript
export function renderDashboard(s: Store, today: string): string
export function renderList(items: Item[] | List[], today: string, type: 'actions' | 'projects' | 'deadlines' | 'waiting'): string
export function renderShow(s: Store, today: string, entity: List | Item): string
```

No new flags. No `--json` in v1.

## Tests

### `tests/render.test.ts` (new)

Pure-function tests for the rendering layer. Seed deterministic stores +
fixed `today`. Inline-string assertions on rendered output (multi-line
template literals — keeps diffs readable; no snapshot library).

Cases:
- Empty store → minimal output, no Hints.
- Active actions only.
- All buckets present.
- `relativeDays` edges: today, tomorrow, in 1 day, in N days, 1 day ago,
  N days ago.
- `truncateNote` boundaries.
- Each hint trigger fires individually.
- All hints fire together → ordering check.
- Empty hints → section omitted entirely.

### `tests/cli.e2e.test.ts`

Update existing list/show tests to assert on markdown shape instead of
JSON. Add e2e for each hint trigger by hand-writing past-date data into
the store before invoking the CLI.

The mutation-response tests (add/edit/lifecycle) keep their JSON
assertions — those paths are unchanged.

## Docs

- **`docs/hints.md`** — new doc. Catalog of triggers, conditions, output
  templates, rationale per hint. Single source of truth for what fires.
- **`docs/spec.md`** — replace "Output" section. Default is markdown;
  document heading conventions and item line grammar; mutation responses
  unchanged. Link to `docs/hints.md` for the hint catalog.
- **`docs/architecture.md`** — note `core/render.ts` and `core/hints.ts`
  modules. Pure, no I/O. One place for all narrative formatting.
- **`README.md`** — update example to show new default output.
- **`docs/agent-guide.md`** — new. Recommended system-prompt snippet for
  agents that consume `todo`. Explains GTD philosophy + how to read
  Hints + when to surface vs. ignore. (Per earlier discussion: the
  system prompt teaches the agent how to use the tool; the tool output
  gives data + nudges per call.)

## Order of work

1. `core/render.ts` skeleton + `renderItemLine` / `renderProjectLine` +
   `relativeDays` + `truncateNote` + unit tests.
2. `renderDashboard` (no Hints yet) + e2e markdown shape test for bare `todo`.
3. `renderShow` for non-projects + projects + e2e tests.
4. `renderList` for the enumeration view + `commands/list.ts` + filter
   wiring + e2e tests for each `<type>` and filter combination.
5. `core/hints.ts` skeleton + `lapsedDeadlines` model helper + unit
   tests for each hint trigger.
6. `renderHints` composer + integrate into `renderDashboard` and
   project-`show`.
7. e2e tests for hints (hand-write store data per trigger).
8. Wire bare `todo` to dashboard via `program.action(...)` in `cli.ts`.
   Replace existing `list.ts` content with the new enumeration command.
   Update existing e2e tests that asserted on JSON-shape `todo list` and
   the help-on-no-args test (bare `todo` now runs the dashboard; help
   moves to `todo --help`).
9. `docs/hints.md` + spec/architecture/README/agent-guide refresh.
10. Bump version → 0.6.0. Publish.

## Out of scope (v1)

- `--json` escape hatch. Add later if real tooling appears.
- `list` filter flags (`--status`, `--project`, `--past`). Add when a real
  use case shows up; for now the agent can call `list <type>` and pick.
- Color / terminal formatting.
- Configurable hint rules. v1 hardcodes the four; users get what they get.
- Per-user hint silencing.
- Item sort/group within a bucket. Backlog item.
- Localised relative dates.
- "Last activity" / recency hints.
