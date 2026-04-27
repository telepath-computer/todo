# Plan: start dates

## Goal

Add the GTD "tickler" / scheduled-action capability: an action can be deferred
*until* a specific date, after which it shows up on the dashboard automatically.

Status enum stays 4-state (`active | deferred | completed | dropped`). Schedule
is modeled as `status='deferred'` plus a non-null `start_at` field — scheduled-
ness is a *view* of deferred items with a future start, not a stored status.

## Schema

New optional field on `ActionItem`:

```typescript
type ActionItem = BaseItem & {
  type: 'action'
  status: Status
  due: string | null
  start_at: string | null     // YYYY-MM-DD; only meaningful when status='deferred'
  closed_at: string | null
}
```

Not added to `WaitingItem` or `ProjectList`.

### Invariants

- `start_at` is only non-null when `status === 'deferred'`.
- Any mutator that changes status to `active`, `completed`, or `dropped`
  also clears `start_at`.
- `start_at` must be a strictly-future date (`> today`) at the moment it's
  written. Past or same-day dates are rejected.
- An older stored `start_at` that has since become past (e.g. set to Sept
  and it's now Oct) is fine — the item just gets promoted into
  `active_actions` by the bucket math.

### Three deferred kinds

| status | start_at | meaning |
|---|---|---|
| `deferred` | `null` | someday/maybe (open-ended) |
| `deferred` | future | scheduled — auto-revives on that date |
| `deferred` | past   | (legacy) effectively active; bucket promotes it |

## CLI surface

The general-purpose mutation verb is `todo edit`. Status is set via
`--active|--deferred|--completed|--dropped` flags (mutually exclusive, optional).
The four lifecycle verbs (`activate`, `defer`, `complete`, `drop`) remain as
common-path conveniences that desugar to `todo edit <id> --<status>`.

### `todo add action`

```
todo add action --title "..." --active       [--project <id>] [--due <date>] [--note <text>]
todo add action --title "..." --deferred [--start <date>] [--project ...] [--note ...]
```

- Exactly one of `--active | --deferred` required.
- `--start <date>` valid only with `--deferred`. With `--active` → reject.
- `--start` parses YYYY-MM-DD or natural language via chrono; must resolve
  to a strictly-future date.
- `--start ""` is rejected on `add` (empty-string is for clearing on `edit`,
  not for declaring on create).

### `todo edit <id>` (the primitive)

```
todo edit <id> [--active | --deferred | --completed | --dropped]
              [--start <date>]
              [--title ...] [--note ...] [--due ...] [--project ...]
```

Field semantics:
- `--note ""` / `--due ""` / `--project ""` clear the field (existing behavior).
- `--start ""` clears `start_at` (no status change).
- `--start <date>` on an action sets `start_at` and **implicitly transitions
  `status` to `deferred`** (regardless of current status: active, deferred,
  or terminal). On a terminal action this also clears `closed_at` — the
  agent's intent to schedule overrides the closed state.
- `--start` is rejected on projects and waiting items.

Status semantics:
- At most one of `--active|--deferred|--completed|--dropped`.
- `--active`, `--deferred`, `--completed`, `--dropped` set status; mutators
  clear `start_at` and `closed_at` as appropriate (per the lifecycle table
  below).
- `--deferred --start <date>` is the explicit "schedule" call.
- `--active --start <date>` rejected (contradiction).
- `--completed --start ...` / `--dropped --start ...` rejected (terminal +
  schedule is meaningless).
- Empty patch (no flags) → `nothing to edit`.

### Lifecycle convenience verbs

Each verb is a 1:1 alias for `todo edit <id> --<status>`. Same validation
rules, same entity-type checks.

```
todo activate <id>                   # ≡ edit <id> --active
todo defer <id> [--start <date>]     # ≡ edit <id> --deferred [--start <date>]
todo complete <id>                   # ≡ edit <id> --completed
todo drop <id>                       # ≡ edit <id> --dropped
```

Lifecycle effects table (applies to both surfaces):

| transition | status | closed_at | start_at |
|---|---|---|---|
| `--active` / `activate` | `active` | cleared | cleared |
| `--deferred` (no `--start`) / `defer` | `deferred` | cleared | cleared |
| `--deferred --start <d>` / `defer --start <d>` | `deferred` | cleared | `<d>` |
| `--completed` / `complete` | `completed` | `now` | cleared |
| `--dropped` / `drop` | `dropped` | `now` | cleared |

Entity-type rules:
- `--active` and `--deferred` rejected on waiting items (no active/deferred
  distinction; no resurrection).
- `--start` rejected on projects and waiting items.
- `--completed` / `--dropped` valid on all three entity types.

## Bucket math

Comparison is against `todayLocal()` (host timezone, `YYYY-MM-DD`):

```
active_actions    = type=action ∧ (
                       status='active' ∨
                       (status='deferred' ∧ start_at != null ∧ start_at <= today)
                    )
                    ∧ parent project active

scheduled_actions = type=action ∧ status='deferred' ∧ start_at != null ∧ start_at > today
                    ∧ parent project active

deferred_actions  = type=action ∧ status='deferred' ∧ start_at = null
                    ∧ parent project active
```

`waiting`, `active_projects`, `deferred_projects` unchanged.

### `todo list` output

```
todo list             # { active_actions, waiting, active_projects }
todo list --all       # also { scheduled_actions, deferred_actions, deferred_projects }
```

`scheduled_actions` is the new bucket under `--all`. `active_actions` auto-
includes any past-due scheduled items.

## Hardening / edge cases

### Timezone

- `start_at` is `YYYY-MM-DD` (date-only, no time, no TZ).
- "Today" comparisons use the host's local timezone via `todayLocal()`.
- A v0.4 binary running in a different TZ from the writer can disagree on
  whether `start_at='2026-09-01'` is past/future at the boundary. Acceptable;
  match `--due`'s existing semantics.

### Date parsing

- `--start today` → resolves to today's date → rejected (`> today` required).
- `--start tomorrow` → tomorrow's date → accepted.
- `--start <past-natural-language>` (e.g. "yesterday") → rejected.
- `--start ""` semantics:
  - On `add` and `defer`: **rejected**. `""` is a clear gesture; nothing to clear at create time, and `defer` without `--start` already means "no start."
  - On `edit`: **clears** `start_at` to null. Status unchanged.
- Invalid input (chrono returns null) → `could not parse date: <input>` (existing).

### Schema compatibility (v0.3 → v0.4)

Stores written by v0.3 don't have `start_at` on actions. `readStore`
normalizes on read: any action missing `start_at` gets `start_at: null`
filled in. No migration commit is needed — the next `writeStore` rewrites
the file with the field populated. Mutators and bucket helpers see strict
`string | null` and stay simple.

### Invariant tolerance

A hand-edit could produce `status='active', start_at='2026-09-01'`. The
bucket helpers don't crash — `active_actions` includes status='active'
without consulting `start_at`, so the orphan `start_at` is just ignored.
Don't auto-normalize on read; the mutator path is the source of truth.

### `--due` vs `--start` collision

An action could have `due='2026-05-01'` and `start_at='2026-09-01'`
(active starting after the deadline). Nonsensical but not corrupting.
No write-time validation; surfaceable to the agent if they care.

### Error message ordering

When multiple validation rules fail (e.g. `defer <project-id> --start <past>`),
**check the entity-type rule first** ("`--start` not allowed on projects"),
then the date-validity rule. Type rejections are clearer than date rejections.

## Errors

New entries in the catalog (in addition to existing):

```
start date must be in the future                      (resolved date <= today)
--start requires --deferred                            (add action --start without --deferred; or edit --active --start)
--start is not allowed on projects                     (defer/edit a project with --start)
--start is not allowed on waiting items                (defer/edit a waiting item with --start)
--start is not allowed with --completed / --dropped    (terminal + schedule contradiction)
```

## Code changes

### `src/core/model.ts`
- Add `start_at: string | null` to `ActionItem`.
- Update `setStatus`:
  - Transitions to `active`/`completed`/`dropped` clear `start_at`.
  - Transitions to `deferred` accept an optional `start_at` parameter; if
    omitted, `start_at` is cleared.
- Update bucket helpers:
  - `liveActions(s, today)` — includes the past-due scheduled bridge.
  - New `scheduledActions(s, today)`.
  - `deferredActions(s)` — narrow to `start_at = null`.
- Update `addAction` to accept optional `start_at`.

### `src/core/store.ts`
- `readStore` normalizes: any action missing `start_at` gets `start_at: null`.

### `src/core/dates.ts`
- New helper `requireFutureDate(input, ref)` — wraps `resolveDueInput`,
  throws `InvalidArgument('start date must be in the future')` if `<= today`.
- New helper `todayLocal()` — returns `YYYY-MM-DD` in local TZ.

### `src/commands/add.ts`
- `addActionCmd` opts add `start?: string`. Validate `--start` requires
  `--deferred`; reject with `--active`. Parse via `requireFutureDate`.

### `src/commands/edit.ts`
- Accept `--active|--deferred|--completed|--dropped` (mutually exclusive)
  and `--start`. Dispatch:
  - Status flag → call `setStatus` (with optional `start_at` if
    `--deferred --start <d>`).
  - `--start` alone → call `setStatus(s, id, 'deferred', start_at)` for
    actions; reject on projects/waiting.
  - Field flags → `editItem`/`editList` as today.
- Action edits can mix field flags with status flag in one call.

### `src/commands/lifecycle.ts`
- `activateCmd`, `deferCmd(start?)`, `completeCmd`, `dropCmd` thin wrappers
  that funnel into the same model mutators as `editCmd` does.

### `src/commands/list.ts`
- `listCmd` `--all` adds `scheduled_actions`.

### `src/cli.ts`
- `add action --deferred [--start <date>]`.
- `edit <id>` gains all four status flags + `--start`.
- `defer <id> [--start <date>]`.
- All flags surface in `--help`.

## Tests

- **`tests/model.test.ts`**:
  - Bucket-helper splits (active vs scheduled vs deferred) by `start_at`.
  - `setStatus` clears `start_at` on transitions to `active`/terminal.
  - `setStatus` to `deferred` with optional `start_at`.
  - `addAction` with `start_at`.
- **`tests/store.test.ts`**: `readStore` normalizes missing `start_at` to null
  on a hand-written v0.3 store.
- **`tests/dates.test.ts`**: `requireFutureDate` rejects today / past;
  accepts tomorrow / future natural language. `todayLocal()` format check.
- **`tests/cli.e2e.test.ts`**:
  - `add action --deferred --start <future>` — happy path.
  - `add action --active --start <date>` → reject.
  - `add action --start <date>` (no `--deferred`) → reject.
  - `add action --deferred --start today` → reject.
  - `add action --deferred --start ""` → reject.
  - `defer <id> --start <future>` and `edit <id> --deferred --start <future>` produce the same entity.
  - `edit <id> --start <future>` on active action → status flips to deferred.
  - `edit <id> --start <future>` on terminal action → status flips to deferred, closed_at cleared.
  - `edit <id> --start ""` clears start_at, leaves status alone.
  - `edit <id> --active --start <date>` → reject.
  - `edit <id> --completed --start <date>` → reject.
  - `defer <id>` (no `--start`) clears any prior `start_at`.
  - `--all` surfaces `scheduled_actions`.
  - Past-due scheduled item appears in `active_actions` (parent active).
  - Parent project deferred → child scheduled hidden from both `active_actions` and `scheduled_actions`.
  - v0.3-shaped action (no `start_at` field) reads cleanly.

## Docs

- **`README.md`** — extend example to show `--deferred --start tomorrow`.
- **`docs/spec.md`** — schema (`start_at`), bucket filters, edit semantics,
  error catalog.
- **`docs/architecture.md`** — note `readStore` normalization,
  `requireFutureDate` and `todayLocal` helpers.

## Order of work

1. Schema + `readStore` normalization + model mutators + bucket helpers + model tests.
2. Date helpers (`requireFutureDate`, `todayLocal`) + tests.
3. CLI: `add action --deferred --start`, `edit` status+start, `defer --start`, list output.
4. e2e tests.
5. Doc refresh.
6. Bump version → 0.4.0. Publish.

## Out of scope

- `start_at` on projects. A project starting on a date is a real GTD use case
  (don't think about Q4 launch until Q3 ends), but parallel decision; ship
  action scheduling first.
- `start_at` on waiting items. Waiting has no active/deferred distinction;
  scheduling doesn't fit.
- Recurrence (`every monday`, `monthly`). Distinct concept.
- Auto-flipping stored status when `start_at` passes (background daemon, cron,
  on-read mutation). Stored status stays `'deferred'`; bucket math is the
  source of effective state.
- Time-of-day on `start_at`. Date-only.
- Atomic `--start` adjustment via the convenience verbs other than `defer`.
  (e.g. `todo activate <id> --start <date>` not supported; use `edit`.)
