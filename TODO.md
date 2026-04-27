# TODO

Backlog for `todo`. Rough buckets; within each, earlier items land first.

## P1 — quality of life

- **Sort / group output.** `todo list` returns insertion order. Add ordering to
  `active_actions` (overdue first, then due-today, then soonest, then undated;
  break ties by `created` asc) and groupings (e.g. by parent project).
- **`activate`/`defer` no-ops are silent.** Currently they always write the
  store and return the entity. Skip the write if state is unchanged so diffs
  stay clean.
- **`--list-id` filter on `todo list`.** Show only items belonging to a
  specific project. Useful when an agent is drilling in.

## P2 — schema extensions

- **Agenda items.** `type: "agenda"` with `with: string` (person to discuss).
  Fits the discriminated-subtype model — new flag on `todo add`, new bucket
  in list views.
- **Situational tags / contexts.** Either a generic `tags: string[]` or a
  typed `where: 'home' | 'computer' | 'errand' | ...`. Open question: free-form
  vs. controlled vocabulary.
- **Multiple list subtypes.** Watchlist, reading list, etc. The `BaseList` /
  `ProjectList` split is already shaped for this.

## P3 — operational

- **Trash / restore.** Real delete (vs. drop) is currently impossible. Add
  `todo trash <id>` that excises from `store.json` and `todo trashed list` if
  ever needed.
- **`--json` / `--ndjson` output mode.** Currently always pretty JSON.
  Compact / streaming forms could matter at scale.
- **Schema-version field at the top of `store.json`.** Future migrations have
  somewhere to look.
- **Read-only mode.** `TODO_READONLY=1` for sandboxed inspection.

## Open questions

- Should `--due` accept time-of-day, or stay date-only?
- Where do `tags`/`where` go on `todo list` — a separate `by_tag` bucket, or
  baked into existing buckets via filter flags?
- Should multiple parent projects per item be possible? (Currently single
  `list` ref.) Probably no — but worth considering before tags land.
