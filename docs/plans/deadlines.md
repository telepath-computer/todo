# Plan: deadlines

## Goal

Add a third item subtype: `deadline`. A deadline is a fact about time, not a
task. It has a date and a title; it shows up on the dashboard while the date
is still in the future and silently disappears once the date passes. The user
can `drop` it (cancelled / no longer tracking) but cannot `complete` or `defer`
it — deadlines aren't tasks.

Use cases: "Q3 launch", "visa expires", "rate lock ends", "tax filing day".
Things you want visible on your radar until they happen, then gone.

## Schema

New status narrowing:

```typescript
type DeadlineStatus = 'active' | 'dropped'   // no 'deferred', no 'completed'
```

New item subtype, alongside `ActionItem` and `WaitingItem`:

```typescript
type DeadlineItem = BaseItem & {
  type: 'deadline'
  status: DeadlineStatus
  date: string                  // YYYY-MM-DD; required, never null
  closed_at: string | null      // non-null iff status='dropped'
}

type Item = ActionItem | WaitingItem | DeadlineItem
```

### Invariants

- `date` is a `YYYY-MM-DD` string, always set, never null.
- `date` must be in the future at the moment it's written (add or edit). Past
  dates that became past via the passage of time are fine — bucket math just
  hides the entity.
- `closed_at` is non-null iff `status === 'dropped'`.
- `DeadlineItem.status` excludes `'deferred'` and `'completed'`. Only
  `active` and `dropped`.
- `Item.project` references an existing `List.id` or is `null` (same as the
  other item subtypes).

### Why `date`, not `due`

Actions reuse `due` as "you should do this by". A deadline's `date` *is* the
deadline — it's not optional, can't be cleared, and doesn't imply an action.
Same shape as `due` (string YYYY-MM-DD), different field name to avoid
overloading semantics across types.

### Why no `completed`

A deadline is a fact about time, not a checkbox. The two terminal-ish states
that make sense are:

- **The date passes.** Bucket math hides it. No status change.
- **The deadline is cancelled.** `drop` it. `closed_at` records when.

"I closed this out before the date" doesn't have an obvious meaning for a
deadline; pre-date hiding feels like overreach. Drop covers cancellation.

## CLI surface

### `todo add deadline`

```
todo add deadline --title "<text>" --date <d> [--project <id>] [--note <text>]
```

- `--title` required, non-empty.
- `--date` required. Parses `YYYY-MM-DD` or natural language via chrono
  (same parser used by `--due` on actions).
- `--date <past-date>` rejected with `date must be in the future: <input>`.
- `--project <id>` must reference an existing project.

### `todo edit <id>` (polymorphic, deadline branch)

```
todo edit <id> [--title ...] [--note ...] [--date ...] [--project ...]
```

- `--date <d>` parses + future-checks; replaces `date`. `--date ""` rejected
  (`date is required and cannot be empty`).
- `--date` rejected on actions, waiting, and projects (mirrors how `--due`
  is rejected on projects/waiting today).
- `--due` rejected on deadlines (deadlines have no `due` — only `date`).
- `--title`, `--note`, `--project` behave the same as on other items.

### Lifecycle

```
todo drop <id>         # status=dropped, closed_at=now
todo activate <id>     # status=active,  closed_at=null  (un-drop)
todo complete <id>     # rejected
todo defer <id>        # rejected
```

- `complete` on a deadline → `cannot complete deadline <id> (deadlines are not tasks; use drop)`
- `defer` on a deadline → `cannot defer deadline <id> (deadlines have no deferred state)`
- `activate` on an active deadline is a no-op (already active). On a dropped
  deadline it un-drops. (Same shape as activate on terminal projects/actions.)

## Bucket math

```
deadlines = type=deadline
            ∧ status='active'
            ∧ date >= today
            ∧ parent.status='active' (or no parent)
```

Past-date deadlines: hidden everywhere by default, even under `--all`.
Reachable only via `todo show <id>`. Same for `status='dropped'`.

If a "graveyard view" turns out to be useful later, add an `expired_deadlines`
bucket under `--all`. Not now.

### `todo list` output

```
todo list
{
  active_actions:  [...],
  active_projects: [...],
  deadlines:       [...],     // new bucket
  waiting:         [...]
}
```

`--all` is unchanged — adds `deferred_actions` and `deferred_projects`. Past
deadlines stay hidden.

Output bucket order (sorted-key JSON does this for us): alphabetical, so the
new `deadlines` slots between `active_projects` and `waiting`.

## Code changes

### `src/core/model.ts`

- Add `DeadlineStatus` narrowing.
- Add `DeadlineItem` to the `Item` union.
- New mutator `addDeadline(s, input)`:
  - `input: { id, created_at, title, date, project?, note? }`
  - Title validation, parent-exists validation (same as `addAction`/`addWaiting`).
  - Returns `{ store, entity }` with `status='active'`, `closed_at=null`.
- Update `editItem` patch to include `date?: string`:
  - Reject `date !== undefined` on `action` / `waiting`.
  - Apply on `deadline`. Future-date validation lives at the CLI boundary
    (same convention as `due`).
- Update `editItem` patch to keep rejecting `due` on `waiting` and add
  `due` rejection on `deadline`.
- Update `setStatus`:
  - `e.type === 'deadline'`: only `active` and `dropped` allowed. Throw
    `InvalidArgument` for `deferred` and `completed` with the messages above.
- New bucket helper `activeDeadlines(s, today)`:
  - `today` is a `YYYY-MM-DD` string passed in (mutators stay pure; no
    `Date.now()` in the model).
  - Filter: `type='deadline' ∧ status='active' ∧ date >= today ∧ parentActive`.

### `src/core/dates.ts`

- New helper `requireFutureDate(input, ref?)`:
  - Wraps `resolveDueInput`.
  - If resolved date `<= today` (in the same local-tz frame), throw
    `InvalidArgument('date must be in the future: <input>')`.
  - Used by `add deadline` and `edit --date`.
  - (Also used by start-dates plan when that lands; safe to land first here
    or there — whichever ships first introduces it.)

### `src/commands/add.ts`

- New `addDeadlineCmd(opts: { title, date, project?, note? })`.
- Parse `opts.date` via `requireFutureDate`.
- Call `addDeadline` with `id=newId()`, `created_at=nowIso()`, parsed date.

### `src/commands/edit.ts`

- Branch on `entity.type === 'deadline'`:
  - Reject `--due` (`--due is not allowed on deadlines`).
  - Reject `--date ""` (`date is required and cannot be empty`).
  - Parse `--date <d>` via `requireFutureDate`.
  - Apply `title`, `note`, `project` like other items.
- On `action` and `waiting` branches: reject `--date` (`--date is not allowed on actions` / `... on waiting items`).
- On `project` branch: reject `--date` (`--date is not allowed on projects`).

### `src/commands/lifecycle.ts`

- `completeCmd` and `deferCmd` rely on `setStatus` to throw the new
  deadline-specific errors — no change needed at the command layer.
- `activateCmd` / `dropCmd` work as-is on deadlines.

### `src/commands/list.ts`

- Compute `today` once (local-tz `YYYY-MM-DD`) and pass to `activeDeadlines`.
- Add `deadlines: activeDeadlines(store, today)` to the default output.
- `--all` unchanged.

### `src/cli.ts`

- New subcommand `add deadline` with `--title`, `--date`, `--project`, `--note`.
- `edit <id>` gains `--date <d>`.
- No new top-level verbs.

## Tests

### `tests/model.test.ts`

- `addDeadline` happy path; rejects empty title; rejects unknown project.
- `editItem` on deadline: `--date` apply; reject `--due`; reject `--date` on
  action and waiting.
- `setStatus` on deadline: `dropped` works (sets `closed_at`); `active`
  un-drops (clears `closed_at`); `completed` and `deferred` throw with the
  expected messages.
- `activeDeadlines` filtering:
  - includes status=active, date >= today, parent active
  - excludes status=dropped
  - excludes date < today
  - excludes parent deferred
  - excludes parent terminal

### `tests/dates.test.ts`

- `requireFutureDate` accepts future `YYYY-MM-DD`, future natural language;
  rejects today, rejects past dates, rejects unparseable.

### `tests/cli.e2e.test.ts`

- `todo add deadline` happy path (JSON shape, written to store).
- `todo add deadline` with past `--date` → error.
- `todo add deadline` with bad project → error.
- `todo edit <id> --date <future>` updates date; `--date <past>` rejected;
  `--date ""` rejected.
- `todo edit <action-id> --date <d>` rejected; `todo edit <deadline-id> --due <d>` rejected.
- `todo complete <deadline-id>` and `todo defer <deadline-id>` rejected with
  the new messages.
- `todo drop <deadline-id>` and `todo activate` (un-drop) round-trip.
- `todo list` includes `deadlines` bucket; past-date deadline absent;
  dropped deadline absent; `--all` does not surface past or dropped.
- Parent-deferred cascade: deadline child of deferred project hidden.

## Docs

- **`README.md`** — extend the GTD-shorthand intro with deadlines as a fourth
  bullet (or fold into the actions/waiting paragraph). Update example to
  include one deadline.
- **`docs/spec.md`** — add `DeadlineItem` schema, `DeadlineStatus` narrowing,
  `deadlines` bucket filter, new error catalog entries, edit/lifecycle
  rejections.
- **`docs/architecture.md`** — note that bucket helpers now take a `today`
  parameter (compute in `commands/list.ts`, not in the model).

## Errors

New entries in the catalog:

| Error | Cause |
|---|---|
| `--date is required for deadlines` | `add deadline` without `--date` |
| `date is required and cannot be empty` | `edit <deadline-id> --date ""` |
| `date must be in the future: <input>` | `add deadline --date <past>` or `edit --date <past>` |
| `--date is not allowed on actions` | `edit <action-id> --date <d>` |
| `--date is not allowed on waiting items` | `edit <waiting-id> --date <d>` |
| `--date is not allowed on projects` | `edit <project-id> --date <d>` |
| `--due is not allowed on deadlines` | `edit <deadline-id> --due <d>` |
| `cannot complete deadline <id> (deadlines are not tasks; use drop)` | `complete` on deadline |
| `cannot defer deadline <id> (deadlines have no deferred state)` | `defer` on deadline |

## Order of work

1. Schema (`DeadlineItem`, `DeadlineStatus`) + `addDeadline` + `setStatus`
   updates + bucket helper + model tests.
2. `requireFutureDate` in `core/dates.ts` + dates tests.
3. CLI: `add deadline`, `edit --date`, list output, `cli.ts` wiring.
4. e2e tests.
5. Doc refresh (README, spec, architecture).
6. Bump version → 0.4.0 (or 0.5.0 if start-dates ships first). Publish.

## Out of scope

- `complete`-ing a deadline. See "Why no `completed`" above.
- `expired_deadlines` bucket. Past deadlines are reachable via `show <id>`;
  if a graveyard view earns its keep later, add it then.
- Time-of-day on `date`. Date-only, matching `due` and `start_at`.
- Recurrence ("every quarter end"). Distinct concept.
- Deadlines on entity types other than items (e.g. project-level deadline as
  a field of `ProjectList`). A deadline as its own item works fine for the
  "Q3 launch" use case via `--project <id>`.
- Auto-conversion of past deadlines to a different state (e.g. on-read
  mutation). Stored status stays `'active'`; bucket math is the source of
  effective state.
