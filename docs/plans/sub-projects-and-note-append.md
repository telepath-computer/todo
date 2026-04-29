# Plan: sub-projects + note append

Two small, independent additions:

1. **Sub-projects** — a project can have a `parent: project_id | null` link.
   Depth strictly 1 (a child cannot itself be a parent). Cascade is one hop.
2. **Note append** — `todo edit <id> --note-append "..."` appends to the
   existing free-form `note` string instead of overwriting.

Both ship together because they target the same workflow: keeping context
attached to long-running projects (e.g. "NY trip" with sub-thread "Sarah
meeting" and accumulating facts like "Sarah prefers Tuesdays").

The structured `notes: Note[]` direction was considered and rejected as
over-engineered for the actual need. If the simple append breaks down
later, the upgrade path is still open.

---

## Part 1 — Sub-projects

### Goal

A project can be marked as a child of another (root) project. The dashboard
stays flat — every active project, parent or child, shows on its own row.
Drilling into a parent via `show <id>` surfaces a `SUB-PROJECTS` section
listing direct children with their counts. Drilling into a child shows the
parent reference in its header.

### Schema

`ProjectList` gains one optional field:

```typescript
type ProjectList = BaseList & {
  type: 'project'
  status: Status
  closed_at: string | null
  parent: string | null         // project id; null = root project
}
```

Not added to actions, waiting, or deadlines. Their existing `project` field
(parent project on items) is unchanged and unrelated.

#### Invariants

- `parent` is either `null` (root) or a valid project id.
- **Depth strictly 1.** A project with `parent !== null` cannot itself be
  the parent of another project.
  - On `add project --parent X`: reject if `X.parent !== null`.
  - On `edit project <id> --parent X`: reject if `X.parent !== null`.
  - On `edit project <id> --parent X`: reject if any other project has
    `parent === id` (i.e. the project being edited already has children
    and would become a grandparent).
  - On `add project --parent X`: reject if `X` is the project being added
    (impossible at create — id is fresh — but cheap to guard against).
- A project cannot be its own parent. Falls out of depth-1 rules.
- Cycles are structurally impossible at depth 1, so no walk-up cycle check
  is needed.
- `parent` field is stored even when null, so the schema stays explicit.

### Cascade

The existing `parentActive` rule on items extends one hop:

> An item is "live" iff its parent project is active **and** that
> project's parent (if any) is also active.

A child project itself shows on the dashboard as long as both:
- the child's own status is `active`, and
- the child's parent (if any) has status `active`.

If the parent is `deferred` / `completed` / `dropped`, the child project
disappears from the dashboard, *and* the child's items disappear too (the
cascade reaches their items because their parent project is itself
suppressed by its parent).

Implementation: `parentActive` becomes a one-extra-hop check. No recursion.

### CLI surface

#### `todo add project`

```
todo add project --title "..." [--note <text>] [--parent <project-id>]
```

- `--parent <id>`: id must resolve to an existing project with
  `parent === null`.
- `--parent ""` rejected on `add` (consistent with existing
  empty-string-clears-on-edit-only convention).

#### `todo edit <project-id>`

```
todo edit <id> [--parent <project-id>] [...other flags...]
```

- `--parent <id>` re-parents (or attaches a previously-root project) only if:
  - `<id>` is an existing project with `parent === null`, **and**
  - the project being edited has no children.
- `--parent ""` detaches: sets `parent` to null. No invariant cost.
- `--parent` is rejected on actions, waiting, deadlines (the existing
  `--project` flag is the parent-link for items; `--parent` is project-only).

#### Display

- **Dashboard** — every active project still shows in `ACTIVE PROJECTS` as
  its own block. Child blocks gain an extra `parent: <title> [<id>]` field,
  rendered only when `parent !== null`. Field placement: after `title`,
  before the count fields.

- **`show <project>`** — header section unchanged for root projects.
  Children show a `parent: <title> [<id>]` field in the project's field
  block (alongside `status`, `created`, `note`).

  Roots that have at least one child gain a new section after `DEADLINES`:

  ```
  SUB-PROJECTS [N]:

  - id: aBcDe123
    title: "Sarah meeting"
    actions: 2
    waiting: 1
    deadlines: 0
  ```

  Same shape as the existing project rendering on the dashboard. Counts
  follow the existing `projectCounts` rule (live items only, terminal
  excluded). The block does NOT show `parent: ...` here (it's redundant —
  context is already established by the section heading).

  Children rendered in `show` use `'show-children'` ctx for the new
  SUB-PROJECTS section.

- **`list projects`** — renders every project (any status) with the
  existing `projectFields` block. Child projects gain the `parent:` field
  in the list context too. No grouping or indentation — the list is flat.

### Bucket math

`activeProjects(s)` already returns projects with `status === 'active'`.
Extend to also require parent (if any) is active.

```typescript
function projectActive(s: Store, p: ProjectList): boolean {
  if (p.status !== 'active') return false
  if (p.parent === null) return true
  const parent = findList(s, p.parent)
  if (!parent) return true   // dangling parent ref — treat as root
  return parent.status === 'active'
}

export function activeProjects(s: Store): ProjectList[] {
  return s.lists.filter((l) => l.type === 'project' && projectActive(s, l))
}
```

`parentActive` (used by item bucket helpers) walks one extra hop:

```typescript
function parentActive(s: Store, projectId: string | null): boolean {
  if (projectId === null) return true
  const parent = findList(s, projectId)
  if (!parent) return true
  if (parent.status !== 'active') return false
  // one extra hop for sub-project cascade
  if (parent.parent === null) return true
  const grand = findList(s, parent.parent)
  if (!grand) return true
  return grand.status === 'active'
}
```

`deferredProjects` is unchanged (status-only).

### Hints

`stalledActiveProjects` already iterates active projects. With the cascade
rule, a child whose parent has become deferred is no longer "active" by
the bucket helper, so it stops being checked for stalling. No change
needed beyond using the new `activeProjects` definition.

`deferredCount` counts deferred projects + scheduled-but-future actions.
Sub-projects don't change the count semantics.

### Errors

Additions to the catalog:

```
parent project not found: <id>                       (--parent points at a non-project, or unknown id)
--parent must be a root project                      (target's parent is non-null)
cannot make this project a sub-project (it has children)   (edit project --parent set, but project already has children)
--parent is not allowed on actions / waiting items / deadlines
```

`--parent ""` is **valid** on edit (detach); rejected on add.

### Code changes

#### `src/core/model.ts`
- Add `parent: string | null` to `ProjectList`.
- `addProject` accepts optional `parent`. Validates: parent exists, parent
  is a project, parent's `parent === null`. Stores null if not provided.
- `editList` accepts `parent?: string | null` in `EditListPatch`.
  Validates: same rules as add, plus the "no children" rule when setting
  a non-null parent.
- New helper `findChildren(s, id): ProjectList[]` (used by show + edit
  validation).
- New helper `projectActive(s, p): boolean` (used by `activeProjects`).
- `parentActive` extends to walk one hop.
- `activeProjects` switches to `projectActive`.
- `projectActiveActions` / `projectDeferredActions` / `projectWaiting` /
  `projectDeadlines` (the `show <project>` helpers) are unchanged — they
  intentionally bypass parent-active for drill-down. A user looking at a
  deferred project can still see its contents.

#### `src/core/store.ts`
- `normalizeStore` fills `parent: null` on any project missing the field
  (forward-compat for v0.6 stores).

#### `src/commands/add.ts`
- `addProjectCmd` opts add `parent?: string`. Pass through to model.

#### `src/commands/edit.ts`
- Recognize `--parent` flag for project entities. `--parent ""` → null,
  `--parent <id>` → string.
- Reject `--parent` on action / waiting / deadline (already does for the
  existing `--project` field check; add a parallel check for the new flag).

#### `src/commands/list.ts`
- No change to filter logic; `renderList` picks up the new field via
  `projectFields`.

#### `src/core/render.ts`
- `projectFields`: insert optional `parent: <title> [<id>]` field after
  `title`, before counts. Helper to resolve the parent title (reuse
  `projectRef`-style lookup, but specifically for projects).
- `renderShowProject`: append a SUB-PROJECTS section using
  `findChildren(s, p.id)`. Children rendered with `'show-children'` ctx.
  In show-children ctx, omit the `parent:` field for the children
  themselves (redundant under the section heading).
- Bonus: `renderShowProject`'s field block already includes `status`,
  `closed`, `created`, `note`. Insert `parent: <title> [<id>]` between
  `status` and `created` for child projects.

#### `src/cli.ts`
- `add project` gains `--parent <id>`.
- `edit <id>` gains `--parent <id>`.
- Surface in `--help`.

### Tests

- **`tests/model.test.ts`**:
  - `addProject` with valid parent → ok.
  - `addProject` with non-existent parent → `InvalidArgument`.
  - `addProject` with parent that has its own parent → `InvalidArgument`.
  - `editList` set parent → ok.
  - `editList` set parent on a project with children → `InvalidArgument`.
  - `editList` set parent to one that already has a parent → `InvalidArgument`.
  - `editList` clear parent (`null`) → ok.
  - `activeProjects` excludes a child whose parent is deferred.
  - `parentActive` cascade: items under a child of a deferred parent are
    not "live."
  - `findChildren` returns direct children only.

- **`tests/store.test.ts`**:
  - `readStore` fills `parent: null` on a project missing the field.

- **`tests/render.test.ts`**:
  - Dashboard project block renders `parent:` field for child, not for root.
  - `renderShowProject` for a root with children includes a SUB-PROJECTS
    section with the right count and child blocks.
  - `renderShowProject` for a child includes `parent:` in its field block.

- **`tests/cli.e2e.test.ts`**:
  - `add project --parent <root-id>` happy path.
  - `add project --parent <unknown>` → error.
  - `add project --parent <child-id>` → error (depth limit).
  - `edit <child-id> --parent ""` detaches.
  - `edit <root-id> --parent <other-root-id>` rejected if root has children.
  - `edit <action-id> --parent ...` rejected (not allowed on items).
  - Dashboard: child project shows on `ACTIVE PROJECTS` with a `parent:`
    field; defer the parent and the child disappears from the dashboard
    along with its items.
  - `show <root-id>` includes SUB-PROJECTS section with child counts.
  - `show <child-id>` shows `parent: <title> [<id>]` in the header.
  - `list projects` renders all projects flat with `parent:` field where
    applicable.

### Out of scope

- Multi-level depth (grandchildren, etc.). Strictly depth 1 to keep
  cascade and validation cheap. Revisit only if demand emerges.
- Auto-cascading status changes (defer parent → defer children's stored
  status). The dashboard cascade already hides them; storage stays clean.
- Dropping the parent when the parent project is dropped. Children stay
  pointing at a dropped parent — `findList` returns a non-active project,
  cascade rule hides them. User can `--parent ""` to detach if they want
  to keep working on a child after the parent is dropped.
- Renaming a relationship to "linked project" or anything other than
  `parent`. The word matches the field, the model, and the depth-1
  reality.
- Showing aggregate counts from sub-projects on the parent's dashboard
  block. Counts stay scoped to the project's own direct items; the
  SUB-PROJECTS section in `show` is where children's counts live.

---

## Part 2 — Note append

### Goal

Make it cheap for an agent (or human) to add a fact to a project's `note`
without having to read the existing note and rewrite the whole field.

```sh
$ todo edit Vh8XLm2k --note-append "Tax office phone: 555-1234"
$ todo edit Vh8XLm2k --note-append "Sarah prefers Tuesdays"
```

Both calls add a paragraph to the existing `note`. No schema change; the
note stays a single `string | null` field.

### Behavior

- If `note` is null, set it to `body`.
- Otherwise, set it to `<existing>\n\n<body>` — two newlines between
  appends so each block renders as its own paragraph in `show`.
- Empty body → `InvalidArgument: "body is required and cannot be empty"`.
- Mutually exclusive with `--note <text>` in the same `edit` call. (Pick
  one: overwrite or append.)
- Returns the canonical entity JSON (same as every mutation), so the
  agent sees the new full `note` value.

### CLI surface

```
todo edit <id> --note-append "<text>"
```

- Valid on every entity type (project, action, waiting, deadline) — the
  `note` field exists on all four.
- Combinable with other field flags (e.g. `--title`, `--due`) in one call.
- Rejected together with `--note`.

### Display

`show` currently truncates `note` to 150 chars via `truncateNote`. With
appends, accumulated notes can easily exceed that. Drop truncation in
`show`:

- `renderShowProject` and `renderShowItem` render the full `note`
  un-truncated.
- Dashboard and `list` keep truncating (those are scan views and
  shouldn't blow out vertically).

The full note in `show` is rendered as a quoted multi-line string. The
existing `quote()` helper escapes newlines? It currently escapes
backslashes and double quotes, but `\n` is preserved as literal in the
JSON string. For the YAML-ish read output, we want the multi-line note
to render readably, not as `"line1\\nline2"`.

Two options:

1. **Quoted block-scalar** (YAML `|`-style): `note: |\n  line1\n  line2`.
   Parsers and humans both read it cleanly. Indentation matters.
2. **Multi-line quoted string**: keep `quote()`, but render literal
   newlines in the output rather than escaping them. The agent sees a
   multi-line `"..."` value spanning lines. Only works if the surrounding
   block format is tolerant.

Recommendation: option 1 (`|`-block) for `show` only. Lists and dashboard
keep quoting+truncating. Add a small `multilineField()` helper that
renders `key: |` with the body indented two spaces on subsequent lines.

### Code changes

#### `src/core/model.ts`
- New mutator `appendNote(s, id, body): { store, entity }`.
  - Resolves entity by id. Polymorphic: works on every entity type.
  - Validates `body.trim().length > 0`.
  - Computes `next.note = entity.note === null ? body : entity.note + '\n\n' + body`.
  - Returns the updated store + entity, using the existing `replaceList` /
    `replaceItem` helpers.

#### `src/commands/edit.ts`
- Accept `noteAppend?: string` in `EditCmdOpts`.
- If both `--note` and `--note-append` provided → `InvalidArgument`
  ("--note and --note-append are mutually exclusive").
- Empty `--note-append ""` → `InvalidArgument` (consistent with
  add-validation; appending nothing makes no sense).
- Order of operations: any status transition first (existing flow), then
  field edits via `editItem`/`editList`, then `appendNote` if requested.
  Single `writeStore` at the end. The combined edit returns one canonical
  entity JSON.

#### `src/cli.ts`
- `edit <id>` gains `--note-append <text>`.

#### `src/core/render.ts`
- New helper `multilineField(key, body)` that emits `key: |` followed by
  indented continuation lines.
- `renderShowProject` and `renderShowItem`: when emitting `note`, switch
  from `quote(truncateNote(...))` to:
  - Single-line note (no `\n`) → keep current behavior (quoted).
  - Multi-line note → use `multilineField`.

  Decision on keeping the quoted form for single-line: yes, single-line
  notes are common and the quotes are useful disambiguation. The
  multiline form only kicks in when needed.

  Dashboard and `list` keep `quote(truncateNote(...))`.

### Errors

```
body is required and cannot be empty                  (--note-append "")
--note and --note-append are mutually exclusive       (both flags in one edit)
```

### Tests

- **`tests/model.test.ts`**:
  - `appendNote` on entity with `note=null` sets the body.
  - `appendNote` on entity with existing note joins with `\n\n`.
  - `appendNote` with empty body throws.
  - `appendNote` works on each of the four entity types.

- **`tests/render.test.ts`**:
  - `renderShowProject` renders multi-line note via `multilineField`.
  - `renderShowProject` renders single-line note as quoted (existing).
  - Dashboard / list still truncates.

- **`tests/cli.e2e.test.ts`**:
  - `edit <id> --note-append "X"` on null-note → entity has `note: "X"`.
  - `edit <id> --note-append "Y"` on `"X"`-note → `note: "X\n\nY"`.
  - `edit <id> --note-append ""` → error.
  - `edit <id> --note "X" --note-append "Y"` → error.
  - `edit <id> --note-append "X" --title "T"` → both applied in one call.
  - `show <id>` after appends renders the full multi-line note.

### Out of scope

- Per-fact ids, timestamps, or removal. The whole point of going light is
  to skip this. If pain emerges, the upgrade is a structured migration
  (parse the existing string into an array of one).
- Append separator configurability. `\n\n` is the default and only.
- Multi-line input via stdin. Shell-quoted argument is enough. Newlines
  within the argument string are preserved as-is (so `--note-append "a\nb"`
  appends the literal two-character sequence `a\nb`; only real newlines
  in the shell argument are real).

---

## Order of work

1. Note append (smaller, independent, immediate value).
   - Mutator, edit command, render helper, tests.
   - Bump version → 0.7.0. Publish.
2. Sub-projects.
   - Schema + normalize + model mutators + cascade.
   - Render: `parent:` field, SUB-PROJECTS section.
   - CLI: add/edit `--parent`.
   - Tests.
   - Doc refresh.
   - Bump version → 0.8.0. Publish.

Ship in two PRs or two commits — they're orthogonal.

## Doc updates (both parts)

- **`README.md`** — extend example to show a sub-project (`add project
  --parent`) and a `--note-append` call. Show the resulting `show <root>`
  output with SUB-PROJECTS.
- **`docs/spec.md`** — schema (`parent` on projects), CLI surface for
  `--parent` and `--note-append`, error catalog.
- **`docs/architecture.md`** — note `parentActive` one-hop cascade,
  `findChildren` helper, `appendNote` mutator, `multilineField` render
  helper.
