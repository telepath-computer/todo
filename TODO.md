# TODO

Backlog for `todo`. Rough buckets; within each, earlier items land first.

## P1 — quality of life

- **Narrative + Advice default for reads.** Flip `todo list` and `todo show`
  to a markdown-style default — `# Active actions (3)` headings, one item per
  line with `(id)` leading, plus a final `## Advice` section that surfaces
  silent-failure cases (lapsed deadlines, stalled active projects, scheduled
  actions about to revive, stale waiting). Keep mutation responses (add /
  edit / lifecycle) as canonical entity JSON. Add `--json` to reads for the
  raw structured shape. This is an interface for an agent — the dashboard
  should *coach* it about what's hidden, not just enumerate what's visible.
  Each Advice note grounded in a specific data condition; ends with concrete
  next commands; absent when nothing's notable. Hand-authored, not
  auto-generated.
- **Sort / group output.** `todo list` returns insertion order. Add ordering to
  `active_actions` (overdue first, then due-today, then soonest, then undated;
  break ties by `created` asc) and groupings (e.g. by parent project).
- **`activate`/`defer` no-ops are silent.** Currently they always write the
  store and return the entity. Skip the write if state is unchanged so diffs
  stay clean.
- **`--list-id` filter on `todo list`.** Show only items belonging to a
  specific project. Useful when an agent is drilling in.

## P2 — schema extensions

- **Memos + review — drafted in [`docs/plans/remember-and-review.md`](./docs/plans/remember-and-review.md).**
  Adds `memo` as a fourth item type alongside action/waiting/deadline,
  with `pinned` for dashboard surfacing and no task semantics. Removes
  `meta.context` and `todo context`. Adds `todo review` as a broad
  weekly sweep. Pivots the `add` family to positional primary text. The
  earlier "notes Take A / Take B" debate is settled by this plan: memos
  cover the standalone-note case; per-entity attached prose beyond the
  inline `note` field stays out of scope.
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
