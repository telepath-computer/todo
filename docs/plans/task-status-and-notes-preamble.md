# Plan — task lanes, contexts, and notes preamble

Three-part change that makes td opinionated about GTD-style task handling, adds contexts, and simplifies how project notes are stored.

## Motivation

Current model has one dimension of task state (`done` / `not done`) and a bespoke `## Notes` section. In practice:

- Tasks fall into three handling lanes — **available** (actionable now), **waiting** (blocked on someone/something), **deferred** (someday/maybe).
- Tasks carry orthogonal **contexts** — where or with whom the task happens (`@errand`, `@phone`, `@agenda:isa`, `@home`). GTD-canonical.
- Project notes naturally belong at the top of the file as free prose.

## Changes at a glance

1. Tasks gain a lane: `available` | `waiting` | `deferred`. Derived from which section the item lives under.
2. The `## Tasks` section is replaced by three siblings: `## Available`, `## Waiting`, `## Deferred`.
3. Tasks gain zero or more **contexts** — `@<string>` tags on the task line, where `<string>` is any non-whitespace sequence.
4. Due-date syntax changes: `@YYYY-MM-DD` → **`!YYYY-MM-DD`**. This frees `@` for contexts.
5. Project notes move from a machine-managed `## Notes` section to the **preamble** — any markdown between frontmatter and `## Available`. `#` at the start of preamble lines is escaped to `\#` so user prose cannot accidentally open a section.
6. **New `## Completed` section** at the bottom of the file. Completing a task via CLI moves it out of its lane and into `## Completed`, grouped under `YYYY-MM-DD:` date labels (plain date lines with a trailing colon — not markdown headings).
7. CLI adds `--available` / `--waiting` / `--deferred` / `--all` flags, and `--context <name>` on add/edit.

## Storage format

```markdown
---
title: Podcast
---

A weekly show on agent tooling.
Hosted by Rupert.

## Available

- [ ] Write release notes !2026-05-01
  Remember migration section.
- [ ] Buy mic @errand
- [ ] Pick up milk @errand @home
- [ ] Ask Isa about the pilot cut @agenda:isa
- [ ] Call the lawyer @phone

## Waiting

- [ ] Reply from Sam

## Deferred

- [ ] Auto-transcripts some day

## Completed

2026-05-01:

- [x] Send invoices
- [x] Post to feed

2026-04-24:

- [x] Buy mic
```

### Section rules

- **Preamble** (between closing `---` of frontmatter and `## Available`) is the project's notes. Prose-oriented markdown — paragraphs, links, bold/italic, lists, code blocks. Trimmed of leading/trailing blank lines on read. **No headings.** `#` at the start of a line is escaped to `\#` on write and unescaped on read.
- **Three reserved lane sections**: `## Available`, `## Waiting`, `## Deferred`. Each uses the same item shape (checkbox line + optional indented italic notes). No sub-headings inside any of them.
- **`## Available` is always emitted** (primary, even when empty).
- **`## Waiting` and `## Deferred` are emitted only when non-empty.**
- **`## Completed`** is an optional archive section at the bottom. Inside it, items are grouped by **`YYYY-MM-DD:`** date labels — plain date lines with a trailing colon, not markdown headings (so they don't perturb document outline / Obsidian rendering). Items under a date label are completed items (`- [x] ...`). Emitted only when non-empty. Date labels sorted newest-first. Items within a date keep file order.
- **Anything after `## Completed`** (or after the last lane section if no Completed) is preserved verbatim.

### Reserved section names

`Available`, `Waiting`, `Deferred`, `Completed` — case-insensitive. Canonical emit order: Available → Waiting → Deferred → Completed.

## Item model

Existing: `done`, `text`, `due?`, `notes?`.

Add:
- `lane: 'available' | 'waiting' | 'deferred' | 'completed'` (internal; defaults to `available`).
- `contexts: string[]` (zero or more opaque strings, e.g. `"errand"`, `"agenda:isa"`, `"phone"`, `"call:dr-smith"`).
- `completedAt?: string` (`YYYY-MM-DD`; present iff `lane === 'completed'`).

Lane is derived from which section the item lives under. Contexts are derived from trailing `@token` tokens on the task line. **Contexts are opaque strings — `:` is not a reserved separator**; td treats the entire string after `@` as the context name. Sorted alphabetically on emit.

Completed items live under `## Completed` → `YYYY-MM-DD:` date labels. `completedAt` is derived from which date label they live under.

## Task-line format

Canonical emit:

```
- [<state>] <text>[ @<context>]...[ !YYYY-MM-DD]
```

- `!YYYY-MM-DD` — at most one due date, emitted last.
- `@<context>` — zero or more context tags. `<context>` is any non-whitespace sequence of characters (including `:`, `.`, etc.). td does not assign meaning to any character within the context string.
- Contexts are emitted in alphabetical order.
- On parse, tokens can appear in any order after the text.
- Notes on a task remain the indented italic line format (`\t*...*`) unchanged.

## Refs

Flat integer namespace across all reserved sections (Available, Waiting, Deferred, Completed) in document read order. Changing an item's contexts doesn't move it within its section, so its ref is stable. Moving between lanes (including complete/uncomplete) may shift refs; standard shift-note applies.

Completed items keep refs (for the sake of `uncomplete`), but they're never surfaced in listings — you rarely address a completed item by ref.

## CLI surface

### `td tasks add`

```
td tasks add --title "Reply from Sam" --project podcast --waiting
td tasks add --title "Ask Isa about pilot" --project podcast --context agenda:isa
td tasks add --title "Buy milk" --project inbox --context errand --context home
```

- Lane flags: `--available` (default), `--waiting`, `--deferred`. Mutually exclusive.
- `--context <name>` can be repeated for multiple contexts.
- Item appended to the end of the relevant section with context tokens trailing.

### `td tasks edit`

```
td tasks edit <ref> --deferred
td tasks edit <ref> --context agenda:bob                     # replaces contexts
td tasks edit <ref> --context errand --context home          # replaces with both
td tasks edit <ref> --context ""                             # clears all contexts
td tasks edit <ref> --due 2026-05-01                         # stored as !2026-05-01
```

- `--context <name>` is repeatable; the flag values collectively become the new context list (full replacement). Not passing `--context` leaves contexts unchanged. Passing `--context ""` clears.
- Lane flags move the item between sections.

### `td tasks complete` / `td tasks uncomplete`

```
td tasks complete <ref>
td tasks uncomplete <ref>
```

- **`complete`** moves the item out of its current lane section and into `## Completed` under a `<today>:` date label (creating the section and date label if needed). The item is stamped `[x]`. `completedAt` is set to today (local date).
- **`uncomplete`** is only valid on items currently in `## Completed`. It moves the item back to `## Available`, resets `[x]` → `[ ]`, drops `completedAt`.
- Completing shifts refs (item leaves its lane); standard shift-note applies. Empty date labels are removed on write.

### `td tasks list`

```
td tasks list                                      # available + waiting, grouped
td tasks list --available
td tasks list --waiting
td tasks list --deferred
td tasks list --all                                # all three lanes grouped
```

- Default view shows **available + waiting** grouped. Deferred hidden unless `--deferred` or `--all`.
- **Completed items are never shown** in `td tasks list`, `td list`, or `td projects show` — the Completed section is archival only.
- No `--context` filter in v0.2 — contexts are display-only (they group the Available lane).

### `td projects add` / `td projects edit`

`--notes <text>` unchanged from the outside; stored as preamble.

### `td projects show`

Preamble → Notes block. `Tasks:` block renders the three active lanes (Available + Waiting + Deferred) grouped, per the Rendering section below. Completed items are excluded.

### `td list` (new)

Cross-project aggregate view.

```
td list         # Tasks + Waiting + Projects
td list --all   # adds Deferred
```

Output sections (each with a **bold** heading):

- **Tasks:** — available items across every project, rendered with the same context-grouped layout as `td tasks list --available` (context-less first, then green `@context` sub-groups).
- **Waiting:** — waiting items across every project, flat.
- **Deferred:** — (only with `--all`) deferred items across every project, flat.
- **Projects:** — every project, rendered with the standard `td projects list` format (`✳ Title  [slug]`, right-aligned ref).

Each item shows its full ref (`[slug#N]`) so you can act on it directly from the dashboard.

## Rendering

### Available lane — grouped by context

Within Available, items are rendered in three sub-groups:

1. Context-less items (flat, no heading).
2. For each distinct context present: a **green, not-bold** `@context` heading, with the items under it (flat).

Context groups appear in the order their first item appears in the file (stable order).

```
[ ] Write release notes          !2026-05-01       [podcast#1]
[ ] Refine brief                                   [podcast#2]

@errand

[ ] Buy mic                                        [podcast#3]

@agenda:isa

[ ] Ask Isa about the pilot cut                    [podcast#4]

@phone

[ ] Call the lawyer                                [podcast#5]
```

### Waiting / Deferred — flat

```
Waiting:

[ ] Reply from Sam                                 [podcast#6]

Deferred:                                          (only if --all or --deferred)

[ ] Auto-transcripts                               [podcast#7]
```

- `Waiting:` and `Deferred:` headings are **bold** (distinct from the non-bold green context headings).
- Waiting and Deferred items do *not* sub-group by context (kept flat; context-filtered views show them flat too).

### Single-lane or single-context views

Flat output, no group headings. (`td tasks list --waiting` = just the waiting items, flat.)

## Parsing + serialization

### Parse order

1. Frontmatter.
2. Preamble: everything until the first recognised section heading. Trim + unescape `\#`.
3. Lane sections (`## Available`, `## Waiting`, `## Deferred`): each a flat list of items.
4. `## Completed` (if present): `YYYY-MM-DD:` date labels (a line matching `^\d{4}-\d{2}-\d{2}:\s*$`), each followed by a flat list of items. Each item's `completedAt` is the date from its enclosing label.
5. Trailing tail: preserved verbatim.

### Task line parse

For each `- [ ] <rest>` (or `- [x] <rest>`):

- Split `<rest>` into tokens on whitespace from the end.
- Strip trailing tokens one by one while they match one of:
  - `!YYYY-MM-DD` → due
  - `@<string>` → context
- The remaining text is the task title.
- Contexts collected are stored in the item; on emit they're re-ordered alphabetically.

### Serialize

- **Task line**: `- [<state>] <text>[ @ctx][ @ctx]...[ !YYYY-MM-DD]` — contexts alphabetical, due last.
- **Section spacing**: one blank line between sections.
- **Completed**: `YYYY-MM-DD:` date labels newest-first; items under each keep file order.

## Out of scope

- Subheadings inside reserved sections. Flat lists only.
- Context as a queryable dimension. `--context` filter on list is *not* in v0.2; contexts are display-only (grouping the Available lane).
- Any back-compat for legacy `@YYYY-MM-DD` due dates or for `## Notes` sections — the parser only recognizes the v0.2 format. Pre-v0.2 files are not supported.
- Sorting by due date within lanes/groups. File order preserved.
- Multi-context display within Waiting/Deferred.
- Any special meaning for `:` inside a context. Contexts are opaque strings.

## Acceptance criteria

- `td tasks add --waiting` emits a `## Waiting` section when none existed; removing the last waiting item removes the section.
- `td tasks edit <ref> --deferred` moves the item; shift-note emitted when refs shift.
- `td tasks list` shows available + waiting; `--all` shows everything; single-lane flags return flat lists.
- `td tasks add --context agenda:isa` stores the item with `@agenda:isa` trailing on the task line.
- An item added with `--context home --context errand` serializes as `- [ ] <text> @errand @home` (alphabetical).
- An item whose text reads literally `agenda:` (e.g. `@agenda:`) parses and round-trips as a context named `agenda:` (no special meaning for `:`).
- Due dates added via `--due 2026-05-01` serialize as `!2026-05-01`. The parser does not recognize `@YYYY-MM-DD` (no legacy support).
- Available lane in grouped output renders context-less items first, then each distinct context under a green non-bold `@name` heading.
- Waiting and Deferred render as flat lists with bold `Waiting:` / `Deferred:` headings.
- `td projects add --notes "..."` writes notes as preamble above `## Available`; preamble `--notes "## Available"` round-trips as literal (escaped as `\## Available`).
- `td list` renders Tasks + Waiting + Projects sections with bold headings; `--all` adds a Deferred section. Completed items are excluded.
- `td tasks complete <ref>` moves the item from its lane to `## Completed` under a `<today>:` date label (creating the section/label if needed) and stamps it `[x]`.
- `td tasks uncomplete <ref>` on a completed item moves it back to `## Available`, strips `completedAt`.
- Empty `YYYY-MM-DD:` date labels are removed on write; empty `## Completed` section is removed when all dates are gone.
- Existing `## Notes` sections in hand-edited files are preserved verbatim as tail (not surfaced as `project.notes`).
- All existing tests either pass or are updated; new tests cover lanes, contexts, and the escape behavior.
