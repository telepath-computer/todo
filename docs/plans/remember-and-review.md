# Plan: memos + review

## Status

Supersedes `docs/plans/context.md` (shipped in v0.9.0 as `meta.context` +
`todo context`). This is a **breaking change**: the store-level context
singleton and the `todo context` command are removed outright. No alias,
no dual-path, no deprecation window.

- `meta.context` is removed from the schema.
- `todo context` is removed from the CLI.
- Renderer paths for the always-on `CONTEXT:` block are deleted.
- One-shot data migration on read: a non-empty `meta.context` becomes a
  single pinned memo, then the field is dropped from the written store.
  Empty or whitespace-only `meta.context` is dropped silently — the
  memo invariant is body required and non-empty, and it must hold from
  day one.
- After the first write, the legacy field is gone.

`docs/plans/context.md` gets a "Superseded by `remember-and-review.md`"
header note when this lands; the file stays for history.

This plan went through several drafts under names like
`remember`/`forget` verbs and a separate `memories[]` collection. The
final design is simpler: a memo is a new item type alongside action,
waiting, and deadline — same grammar, no task semantics.

### Scope expansion: pivot `add` family to positional

This plan also pivots the four existing `add` subcommands from required
`--title` flags to required positional primary text. Justified by:

- Adding `add memo "<text>"` would otherwise be the only positional
  create in the CLI — accidental inconsistency.
- Single-user, early tool, no back-compat constraints.
- Existing `--title` everywhere is verbose for daily use.

Concretely:

```sh
todo add project   "Plan Q3" [--note <text>] [--parent <id>]
todo add action    "Buy milk" [--note <text>] [--due <date>] [--start <date>] [--project <id>] [--active|--deferred]
todo add waiting   "Reply from Sam" [--note <text>] [--project <id>]
todo add deadline  "Tax due" --date 2026-05-01 [--note <text>] [--project <id>]
todo add memo      "Sam is in hospital" [--pinned] [--project <id>]
```

`--date` on `add deadline` stays a required flag — it's a second
required field, not the primary content.

## CLI Convention

Written down as a load-bearing rule, since the rest of the plan
depends on it:

> At most one free-text positional per command, and it must be the
> command's primary subject. All modifiers are flags. All non-primary
> required fields are flags.

This rule disarms the slippery slope (no, `--note` does not also
become positional). It applies equally to `add <type>` and any future
create command.

## Memo Entity

A memo is a fourth item type alongside action, waiting, and deadline.
Same shape pattern, no task semantics.

### Type

```typescript
type Memo = {
  id: string
  type: 'memo'
  note: string
  pinned: boolean
  project?: string   // optional parent project id, like other items
  created_at: string
}

type Item =
  | ActionItem
  | WaitingItem
  | DeadlineItem
  | MemoItem
```

Memos live in `items[]` with `type: 'memo'` as the discriminator. No
separate collection, no new array — the polymorphic id resolver,
`show`, `edit`, and `list` all extend naturally.

### Field rationale

- `note` matches the existing `note` field on other items
  semantically. A memo *is* a free-standing note.
- No `title` — short facts ("Sam is in hospital") don't have a
  sensible separate title; the note is the content.
- `pinned` is unique to memos. The only awkward part of the shape;
  worth it for the dashboard affordance.
- `project` is optional, matching how actions, waiting, and deadlines
  attach to projects.
- No status enum. Memos exist or are dropped (hard-deleted).
- No `closed_at`. Memos have no terminal state to record.

### Interface

```sh
todo add memo "<text>" [--pinned] [--project <id>]
todo list memo
todo show <id>
todo edit <id> [--note "<text>"] [--pinned | --no-pinned] [--project <id>]
todo drop <id>
```

`todo add memo "<text>" [--pinned] [--project <id>]`

- Creates one memo with the positional text as `note`.
- Body is required (commander's required-positional check enforces);
  must be non-empty after trimming.
- `--pinned` defaults false; sets `pinned=true` on create.
- `--project <id>` optionally attaches to a project, same semantics as
  other items.
- Returns canonical entity JSON for the created memo.

`todo list memo`

- Slots into the existing `todo list <type>` pattern.
- Renders all memos under a `MEMOS [N]:` heading, one YAML-like block
  per item, full body as a `|` block scalar (not truncated).
- Order: pinned first, then unpinned; within each, newest first.

`todo show <id>`

- Resolves polymorphically across all entity types including memos.
- For memos, renders the same YAML-like block as `list memo`, scoped
  to one item.
- Standard `not found: <id>` error if id matches no entity. Dropped
  memos are gone — same response as a never-existed id.

`todo edit <id>`

- Polymorphic. When `<id>` is a memo, accepts `--note <text>`,
  `--pinned`/`--no-pinned`, and `--project <id>`.
- `--note ""` is rejected (`note is required and cannot be empty`).
- `--pinned` and `--no-pinned` are commander's auto-generated negation
  pair, sharing one storage slot — passing both is harmless
  (last-write-wins) and needs no explicit mutual-exclusion check.
- `--project ""` clears the parent, matching existing item behavior.
- At least one memo field is required when editing a memo.
- Other entity types reject `--note` and `--pinned`/`--no-pinned`.

`todo drop <id>`

- Polymorphic. For action/project/waiting/deadline, sets
  `status=dropped` and `closed_at=now` (existing behavior).
- For memo, **hard-deletes** the entry from `items[]`. Memos have no
  status to set. The verb's user-meaning is consistent ("get rid of
  this"); the model layer branches on entity type.
- Returns the canonical entity JSON before removal — the response is
  the last view of the memo.

`activate`, `defer`, `complete` error on memo ids:
`<id> is a memo and has no status`. Memos don't participate in the
status enum.

### Pinning ergonomics

`pinned` is the user's "show this every time I check in" toggle, not a
priority flag. Pinned memos appear on the daily dashboard under
`KEEP IN MIND:`; unpinned memos surface only on `todo review` and
`todo list memo`.

On create, items default to `pinned=false`. There is no flag to
explicitly opt in to the default, since `--pinned` already means "opt
in to pinning."

## Dashboard And Review Reads

Today the bare dashboard is the only coached read surface. After this
change there are two read surfaces with distinct roles:

- `todo`: the daily dashboard, focused and narrow.
- `todo review`: the weekly sweep, broad but still non-terminal.

Each label has a stable filter and stable count across surfaces. Where
a surface needs a different filter, it gets a different label —
matching the existing convention (`ACTIVE ACTIONS` vs `DEFERRED
ACTIONS`).

### `todo` (daily dashboard)

```text
KEEP IN MIND [N]:        # only when there are pinned memos

ACTIVE ACTIONS [N]:
WAITING [N]:
DEADLINES [N]:           # active deadlines with date >= today
ACTIVE PROJECTS [N]:
HINTS:
```

Rules:

- `KEEP IN MIND:` includes memos where `pinned=true`. Empty section
  omitted.
- The other sections keep their existing bucket rules.
- `HINTS:` remains dashboard-scoped.

### `todo review` (weekly sweep)

```text
MEMOS [N]:

ACTIVE ACTIONS [N]:
DEFERRED ACTIONS [N]:
WAITING [N]:
DEADLINES [N]:
ACTIVE PROJECTS [N]:
DEFERRED PROJECTS [N]:
HINTS:
```

Rules:

- `MEMOS:` includes **all** memos, regardless of `pinned`.
- `ACTIVE ACTIONS` and `DEFERRED ACTIONS` reuse current bucket math:
  scheduled deferred actions with `start_at <= today` appear only in
  `ACTIVE ACTIONS`.
- `WAITING` reuses the current active waiting bucket.
- `DEADLINES` includes all active deadlines, including ones with dates
  in the past that haven't been dropped.
- `ACTIVE PROJECTS` and `DEFERRED PROJECTS` surface all non-terminal
  projects.
- Completed, dropped, and forgotten entities are out of scope; review
  is broad, not an audit log.

### Pinning is daily/weekly, not priority

`KEEP IN MIND` (dashboard, pinned) and `MEMOS` (review, all) are
filters of the same underlying set. Pinning promotes a memo from
`MEMOS` to `KEEP IN MIND`. The user pins what they want to see every
check-in; everything else still surfaces on review.

### Hints on `todo review`

`todo review` keeps the existing actionable hints:

- recent lapsed deadlines
- stalled active projects
- stale waiting items

The deferred-count hint is omitted on `review`, because deferred
actions and deferred projects are already visible there.

Implementation: `renderHints` (or its model-side feeder) takes a
`mode: 'dashboard' | 'review'` parameter. The deferred-count hint is
gated on `mode === 'dashboard'`; the actionable hints fire in both
modes. One parameter, one conditional — no duplicated hint generator.

## Commands And Ownership

CLI surface changes:

- Remove `context [text]` and `meta.context`.
- Pivot `add project|action|waiting|deadline` from `--title <text>` to
  required positional title.
- Add `add memo "<text>" [--pinned] [--project <id>]`.
- Extend `list <type>` to accept `memo`.
- Extend `show <id>`, `edit <id>`, and `drop <id>` resolvers to
  include memos.
- Add `review` (top-level read).

Responsibility changes:

- The model gains the `MemoItem` discriminated union arm and create /
  edit / drop helpers.
- The polymorphic id resolver (used by `show`, `edit`, `drop`,
  `activate`, `defer`, `complete`) now also matches memos; status
  verbs error on memo ids with a clear message.
- `drop` model branches on entity type: hard-delete for memos,
  status-set for everything else.
- The renderer gains `KEEP IN MIND:` and `MEMOS:` block rendering
  plus a dedicated review renderer.
- The CLI wiring removes `context`, reshapes the four `add`
  subcommands to use a required positional, adds `add memo`,
  `review`, and the `memo` arm of `list`/`show`/`edit`/`drop`.
- Store normalization handles the `meta.context` to memo migration.

### Errors

- Standard commander missing-positional message for bare
  `todo add memo` and the other add commands.
- `note is required and cannot be empty` for `--note ""` on edit.
- `--note is only allowed on memos` for non-memo edit ids.
- `--pinned is only allowed on memos` (covers both `--pinned` and
  `--no-pinned`, which share storage) for non-memo edit ids.
- `<id> is a memo and has no status` for `activate`, `defer`, or
  `complete` against a memo id.
- Standard `not found: <id>` for missing ids; dropped memos no
  longer exist and read identically to never-existed ids.

### Tests

- `add memo "<text>"` creates a memo with `pinned=false` by default;
  `--pinned` opts in.
- `add memo` with no args errors (commander's missing-positional
  message).
- `list memo` renders all memos under `MEMOS [N]:` with full
  multi-line bodies as block scalars; pinned-first ordering.
- `show <memo-id>` renders the same single-item block.
- `edit <memo-id> --note`, `--pinned`, `--no-pinned`, `--project`
  work; reject `--note ""`; reject status flags.
- `edit <memo-id>` with no memo fields errors symmetrically with
  `edit <memo-id>` against a non-existent id (consistency check).
- `drop <memo-id>` hard-deletes; subsequent `show` and `edit` return
  `not found: <id>`.
- `activate`/`defer`/`complete` on memo ids return the
  `has no status` error.
- `todo` renders pinned memos under `KEEP IN MIND:` and omits the
  section when there are none.
- `todo review` renders all memos under `MEMOS:` plus deferred
  actions, deferred projects, and active lapsed deadlines.
- `todo review` keeps actionable hints but drops the deferred-count
  hint.
- All four pre-existing `add` subcommands accept the title as a
  required positional rather than `--title`. Existing add tests
  update to the new shape.
- Legacy `meta.context` migrates to a single pinned memo when
  non-empty; whitespace-only or empty `meta.context` is dropped
  silently.
- `context` is no longer present in help output or accepted as a
  command.
- Mutation commands continue to return canonical JSON for memos.

## Out Of Scope

- First-class attached prose on action/project/waiting/deadline
  beyond the existing inline `note` field. Memos cover the
  standalone-note case; richer per-entity notes are a separate
  design question.
- Status semantics on memos (`active`, `deferred`, `completed`).
- A status enum or audit trail for dropped memos. Drop is final;
  dropped memos are gone.
- Sub-memos or memo hierarchy (no `--parent`).
- Sorting/grouping changes beyond the new sections described here.

## Docs To Update

- `README.md`
- `docs/spec.md` — add `memo` to entity types; document `MEMOS` and
  `KEEP IN MIND` sections; record the positional-create rule.
- `docs/architecture.md`
- `docs/agent-guide.md`
- `TODO.md` — drop the older context/notes Take A vs Take B
  discussion; this plan settles it.
- `docs/plans/context.md` — add "Superseded by
  `remember-and-review.md`" header note; do not delete.
