# Plan: start dates

## Goal

Add the GTD "tickler" / scheduled-action capability: an action can be deferred
*until* a specific date, after which it shows up on the dashboard automatically.

Status enum stays 4-state (`active | deferred | completed | dropped`). Schedule
is modeled as `status='deferred'` plus a non-null `start_at` field — the
scheduled-ness is a *view* of deferred items with a future start, not a stored
status.

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

Not added to `WaitingItem` or `ProjectList` (out of scope; see below).

### Invariants

- `start_at` is only non-null when `status === 'deferred'`.
- `start_at` must be a future date at the moment it's set (past dates rejected
  at write time; existing past `start_at` is allowed and just makes the item
  effectively active in the bucket math).
- `activate`, `defer`, `complete`, `drop` all clear `start_at` (mutators
  set it to `null` as a side effect of changing status).
- `schedule` sets `status='deferred'` and `start_at=<date>`.

### Three deferred kinds

| status | start_at | meaning |
|---|---|---|
| `deferred` | `null` | someday/maybe (open-ended) |
| `deferred` | future | scheduled — auto-revives on that date |
| `deferred` | past   | (legacy) effectively active; bucket promotes it |

## CLI surface

### `todo add action`

Three mutually-exclusive mode flags (today's two + one new):

```
todo add action --title "..." --active       [...]
todo add action --title "..." --deferred     [...]
todo add action --title "..." --start <date> [...]
```

- `--active` — `status=active`, `start_at=null`.
- `--deferred` — `status=deferred`, `start_at=null`.
- `--start <date>` — `status=deferred`, `start_at=<date>`. (No separate `--scheduled` flag — `--start` IS the schedule mode.)

Validation:
- Exactly one of the three is required.
- `--start` requires a date that parses (YYYY-MM-DD or natural language via chrono).
- `--start <past-date>` rejected with `start date must be in the future`.

### Lifecycle (new verb)

```
todo schedule <id> --start <date>
```

- Only valid on actions. (Rejects projects and waiting.)
- Sets `status='deferred'`, `start_at=<date>`, clears `closed_at`.
- `--start` required. Same date-parse + future-only rule as `add`.

Existing verbs gain `start_at` clearing as a side effect:

```
todo activate <id>     # ... + start_at=null
todo defer <id>        # ... + start_at=null     ← clears any prior schedule
todo complete <id>     # ... + start_at=null
todo drop <id>         # ... + start_at=null
```

### `todo edit <id>`

`--start` becomes editable on actions:

```
todo edit <id> [--title ...] [--note ...] [--due ...] [--project ...] [--start ...]
```

- Setting `--start <date>` on an action implicitly transitions to `status='deferred'` if it isn't already.
- `--start ""` clears `start_at` (does NOT change status).
- `--start` rejected on projects and waiting (same as `--due`).

Open question: should `--start <date>` on an `active` action force it to `deferred`? Or should we reject and require explicit `todo schedule`? **Default: implicit transition** — keeps `edit` as a single point for tweaking item fields. The agent that sets a future `--start` clearly wants the item scheduled.

## Bucket math

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

`scheduled_actions` is new under `--all`. `active_actions` automatically includes any past-due scheduled items (they "drop into" the dashboard once their `start_at` arrives).

## Code changes

### `src/core/model.ts`
- Add `start_at: string | null` to `ActionItem`.
- New mutator `setSchedule(s, id, start_at)`:
  - Find action, throw if entity is not an action.
  - Validate `start_at` is a future date — but: validation belongs at the CLI boundary (`commands/lifecycle.ts`), not the pure mutator. The mutator just stores it.
  - Set `status='deferred'`, `start_at=<date>`, `closed_at=null`.
- Update `setStatus`:
  - When transitioning to `active` / `deferred` / `completed` / `dropped`, also clear `start_at`.
- Update bucket helpers:
  - `liveActions` — include the past-due scheduled bridge.
  - New `scheduledActions(s, today)`.
  - `deferredActions` — narrow to `start_at=null`.
- Update `addAction` to accept optional `start_at` input.

### `src/core/dates.ts`
- New helper `requireFutureDate(input, ref)` that wraps `resolveDueInput` and throws `InvalidArgument` if the resolved date is `<= today`.

### `src/commands/add.ts`
- `addActionCmd` opts add `start?: string`.
- Validation: exactly one of `active | deferred | start` required.
- If `start`: parse via `requireFutureDate`, call `addAction` with `status='deferred'`, `start_at=<resolved>`.

### `src/commands/lifecycle.ts`
- New `scheduleCmd(id, start)`.

### `src/commands/edit.ts`
- Accept `--start`. On action: parse via `requireFutureDate` (or `null` if `""`), set `start_at` and (if non-null) flip `status='deferred'`.
- Reject on projects/waiting.

### `src/commands/list.ts`
- `listCmd` `--all` adds `scheduled_actions` to the output.

### `src/cli.ts`
- New subcommand `add action --start <date>` (already covered if `--start` flag exists).
- New verb `todo schedule <id> --start <date>`.
- New flag `todo edit <id> --start <date>`.

## Tests

- **`tests/model.test.ts`**: bucket-helper splits (active vs scheduled vs deferred) by `start_at`; mutators clear/set `start_at`; `setSchedule` rejects non-actions.
- **`tests/cli.e2e.test.ts`**: `add action --start`, `todo schedule <id> --start`, `todo edit --start`, past-date rejection, scheduled-action with past start auto-appears in `active_actions`, `--all` surfaces `scheduled_actions`, `defer` clears a previously-scheduled `start_at`.

## Docs

- **`README.md`** — update example to mention scheduling once.
- **`docs/spec.md`** — schema (add `start_at`), bucket filters, validation, errors.
- **`docs/architecture.md`** — bucket-helper layer change.

## Order of work

1. Schema + mutators + bucket helpers + model tests.
2. Date helper (`requireFutureDate`) + dates tests.
3. CLI: `add action --start`, `todo schedule`, `todo edit --start`, list output.
4. e2e tests.
5. Doc refresh.
6. Bump version → 0.4.0. Publish.

## Out of scope

- `start_at` on projects. A project starting on a date is a real GTD use case
  (don't think about Q4 launch until Q3 ends), but adding it is a parallel
  decision; ship action scheduling first.
- `start_at` on waiting items. Waiting has no "active vs deferred" distinction;
  scheduling doesn't fit.
- Recurrence / repeating items (`every monday`, `monthly`). Distinct concept.
- Auto-flipping stored status when `start_at` passes (background daemon, cron,
  on-read mutation). Stored status stays `'deferred'`; bucket math is the
  source of effective state.
- Time-of-day on `start_at`. Date-only (`YYYY-MM-DD`), matching `due`.
- "Started but not yet active" intermediate state. If you set start_at to
  the past, the item is effectively active by bucket math; that's enough.
