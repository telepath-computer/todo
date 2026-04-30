# Plan: dated memos

## Status

Follow-on to the memo+review change shipped in v0.10.0
(`docs/plans/remember-and-review.md`). Adds time-based visibility to
memos via a single `start_at` field, replacing the `pinned` boolean.

This is a **breaking change** to the memo schema: `pinned` is removed,
replaced by date-based availability. No migration code; existing memos
(currently all `pinned: true|false`) lose the field on read and become
"always available" (since they have no `start_at`).

Deadlines are not changed in this plan.

## Overview

Single schema addition: **memos gain `start_at`.** Visibility on the
dashboard is purely date-driven. `pinned` goes away.

Plus a dashboard layout tweak: the memo block (`KEEP IN MIND`) moves
to the bottom of the daily dashboard. Work first, context last.

No `expires_at`. A memo lingers until the user `drop`s it. The
"vacation Mon–Fri" use case is handled by manual cleanup; auto-expiry
adds a field, a selector, and review noise that isn't worth it.

## The Three Concepts (recap)

This plan keeps the existing three-concept distinction:

- **Note** (lower-case): the inline prose field on every entity. A
  memo's note is its body; a project's note is its description.
- **Memo**: an addressable, possibly future-dated piece of durable
  context. The memo *is* the entity; its `note` field is its body.
- **Deadline**: a date-anchored marker that something is due.
  Distinct from a memo because the date is the load-bearing semantic.

## Schema

### Memo

```typescript
type Memo = {
  id: string
  type: 'memo'
  note: string
  start_at: string | null      // YYYY-MM-DD; null = always available since creation
  project: string | null       // optional project link, label only
  created_at: string
}
```

Removed: `pinned`. Added: `start_at`.

## Visibility Rules

A memo is **available** (and surfaces on the dashboard) iff:

```
start_at == null OR start_at <= today
```

Otherwise it's **deferred** (`start_at > today`), still in the store
but not on the dashboard. Deferred memos appear on `todo review`.

There is no "expired" state. Memos persist until the user `drop`s
them.

### Project status does NOT gate

A memo attached to a deferred project still surfaces on the dashboard
if its own dates make it available. Project status is not a
visibility filter — only the memo's own `start_at` is.

This is a deliberate departure from how actions cascade. Memos are
context, not work; a project being deferred shouldn't hide a
date-critical memo about it.

## Dashboard And Review

### `todo` (daily dashboard)

```text
ACTIVE ACTIONS [N]:
WAITING [N]:
DEADLINES [N]:
ACTIVE PROJECTS [N]:
KEEP IN MIND [N]:        # available memos (start_at <= today or null)
HINTS:
```

Changes:
- `KEEP IN MIND` moved from old top-of-dashboard position to the
  bottom (after `ACTIVE PROJECTS`, before `HINTS`).
- `KEEP IN MIND` shows **available** memos only (date filter).

### `todo review` (weekly sweep)

```text
MEMOS [N]:               # all memos; deferred ones get a date hint
ACTIVE ACTIONS [N]:
DEFERRED ACTIONS [N]:
WAITING [N]:
DEADLINES [N]:
ACTIVE PROJECTS [N]:
DEFERRED PROJECTS [N]:
HINTS:
```

Changes:
- `MEMOS` shows everything (available and deferred). Deferred memos
  render with a `(starts 2026-05-12, in 5 days)` hint next to
  `start_at`. Available memos with a past `start_at` just render the
  date as informational.
- No expired bucket — `expires_at` doesn't exist.
- Other sections unchanged.

### Hints

No new hints in this change.

## CLI

```sh
todo add memo "<text>" [--start <date>] [--project <id>]
todo edit <memo-id> [--note <text>] [--start <date>] [--project <id>]
```

- `--start <date>`: sets `start_at`. `''` clears.
- `--pinned` and `--no-pinned`: removed entirely. Reject with a clear
  error so an old habit doesn't silently misfire.
- Date format: same as actions — `YYYY-MM-DD` or natural language
  (chrono-node).

### Errors

- `--pinned is not a memo flag (use --start)` and `--no-pinned is not
  a memo flag` — friendly redirect during the transition.

## Render Details

### Memo block

Memo render fields (in order):
- `id`
- `note` (full body; multi-line as YAML `|` block scalar)
- `start_at` (only when set; for deferred memos in review, append
  `(starts 2026-05-12, in 5 days)`)
- `project` (only when set, with label `<title> [<id>]`)

On `todo` (KEEP IN MIND), available memos only. The `start_at` line
is present-but-informational when set.

On `todo review` and `todo list memo`, all memos.

## Model Changes

- `MemoItem`: drop `pinned`, add `start_at`.
- `addMemo` input: drop `pinned`, accept `start_at`.
- `editItem` for memos: drop `pinned` handling, accept `start_at`
  patches.
- New selectors:
  - `availableMemos(s, today)` — replaces `pinnedMemos`
  - `deferredMemos(s, today)` — `start_at > today`
- Drop `pinnedMemos` entirely.

## Forward-Compat On Read

`normalizeStore` ignores any `pinned` field on memos found in stored
data (TypeScript drops the unknown field; on the next write it's
gone). `start_at` defaults to `null` when missing.

No explicit migration step needed.

## Tests

- Memo create with `--start` round-trips through the store.
- Memo create with `--pinned` errors with the friendly redirect.
- Memo edit replaces `start_at`; `''` clears it.
- Availability selectors:
  - memo with no `start_at` → available
  - memo with `start_at` in past → available
  - memo with `start_at` in future → deferred (not in
    `availableMemos`)
  - memo with `start_at == today` → available
- Dashboard render: `KEEP IN MIND` appears at the bottom, after
  `ACTIVE PROJECTS`, before `HINTS`.
- Dashboard render: only available memos appear under `KEEP IN MIND`.
- Review render: `MEMOS` includes deferred memos with the
  `(starts ..., in N days)` hint.
- Existing memos in stored data with `pinned: true` and no dates
  load cleanly and are available.

## Out Of Scope

- `expires_at` on memos. Manual `drop` covers cleanup. Add later if
  the friction is real.
- Warning windows on deadlines. The existing countdown is enough.
- Notifications.
- Recurring memos.
- Hints about upcoming-soon items.
- Renaming the entity "memo" or the inline `note` field.
- Collapsing deadlines into memos.

## Docs To Update

- `README.md` — mention `--start` on memos.
- `docs/spec.md` — schema additions; KEEP IN MIND moved to bottom of
  dashboard; visibility rules.
- `docs/architecture.md` — note the new selectors.
- `docs/agent-guide.md` — update the memo section.
