# Plan: top-level context

## Goal

A store-level singleton `context` field that always renders at the top of
the dashboard. A reliable place for orienting prose the agent will see on
every read of `todo`:

- "this week heads-down on demo build, no meetings before noon"
- "today: ship demo prep, email Sarah"
- "see Notes/Planning/Q3.md for goals"

## Schema

```typescript
type StoreMeta = { context: string | null }

type Store = {
  meta: StoreMeta
  lists: List[]
  items: Item[]
}
```

- `null` is canonical for "not set". Empty string is rejected at write
  time.
- `EMPTY_STORE` initialises `meta: { context: null }`.
- `readStore` normalises older stores (no `meta`) to
  `meta: { context: null }`.

## CLI surface

```
todo context                       # read
todo context "<text>"              # replace ('' clears to null)
todo context --append "<text>"     # append, joined with \n\n
```

- Positional `<text>` and `--append <text>` are mutually exclusive.
- `--append ""` is rejected: `body is required and cannot be empty`.

### Read (narrative)

Bare `todo context` emits a YAML `|`-block scalar, even for single-line
content, so parser shape is predictable regardless of body content:

```
CONTEXT: |
  heads-down on demo this week
  see Notes/Planning/Q3.md for goals
```

When `meta.context` is null, still emit the heading with an
agent-directed placeholder, so the slot is visible and self-explanatory:

```
CONTEXT: |
  (empty — agent: store the user's current goals, priorities, focus, or
  pointers to relevant docs here. Not actions, deadlines, or projects;
  those have their own commands.)
```

### Mutations (JSON)

Flat shape; the `meta` namespace is a storage detail, hidden from the
CLI surface:

```sh
$ todo context "heads-down on demo"
{"context": "heads-down on demo"}

$ todo context --append "see Notes/Planning/Q3.md"
{"context": "heads-down on demo\n\nsee Notes/Planning/Q3.md"}

$ todo context ""
{"context": null}
```

## Dashboard render

Always prepend a CONTEXT block as the first section, before
`ACTIVE ACTIONS`. Same shape as bare `todo context` reads:

When set:
```
CONTEXT: |
  heads-down on demo this week
  see Notes/Planning/Q3.md for goals

ACTIVE ACTIONS [N]:
...
```

When null — show the empty slot with the agent-directed hint, so the
agent reading the dashboard always sees the slot exists and what kind of
content goes there:
```
CONTEXT: |
  (empty — agent: store the user's current goals, priorities, focus, or
  pointers to relevant docs here. Not actions, deadlines, or projects;
  those have their own commands.)

ACTIVE ACTIONS [N]:
...
```

Always block-scalar form, every body line indented 2 spaces. No
truncation.

## Code changes

### `src/core/model.ts`
- Add `StoreMeta` type. `Store` gains `meta: StoreMeta`.
- `EMPTY_STORE` → `meta: { context: null }`.
- `setStoreContext(s, body: string | null) → Store` — replaces. Empty
  string → null.
- `appendStoreContext(s, body: string) → Store` — joins with `\n\n` (or
  sets if currently null). Throws `InvalidArgument` on empty/whitespace
  body.

### `src/core/store.ts`
- `normalizeStore` fills `meta: { context: null }` when missing.

### `src/commands/context.ts`
- New file. `contextCmd(text?: string, opts: { append?: string }) → string`.
- Validates mutual exclusion of positional + `--append`.
- Bare read: returns narrative block-scalar (or empty when null).
- Set / append: returns canonical `{"context": ...}` JSON.

### `src/cli.ts`
- New `program.command('context [text]')` with `--append <text>` option.
- Wires to `contextCmd`.

### `src/core/render.ts`
- New `renderContextBlock(s)` — emits `CONTEXT: |\n  <indented body>` or
  empty string when null.
- `renderDashboard` prepends it.

## Tests

### `tests/model.test.ts`
- `setStoreContext` with body sets; with null clears; empty string → null.
- `appendStoreContext` joins with `\n\n` when existing; sets when null;
  throws on empty/whitespace body.
- Immutability of input store.

### `tests/store.test.ts`
- `readStore` normalises a pre-`meta` store to `meta: { context: null }`.

### `tests/render.test.ts`
- Dashboard with `meta.context` set prepends `CONTEXT: |` block-scalar
  with indented body, before `ACTIVE ACTIONS`.
- Single-line and multi-line both render as block-scalar.
- No CONTEXT block when null.

### `tests/cli.e2e.test.ts`
- Bare `todo context` on fresh store → empty stdout.
- `todo context "foo"` → JSON `{"context": "foo"}`, persists.
- `todo context ""` → JSON `{"context": null}`, clears.
- `todo context --append "bar"` on empty → sets; on existing → joins.
- `todo context "x" --append "y"` → error (mutually exclusive).
- `todo context --append ""` → error (empty body).
- Bare `todo context` after set → narrative `CONTEXT: |\n  foo`.
- Dashboard prepends CONTEXT block after set.
- `meta.context` persists in `store.json` under the `meta` namespace.

## Errors

```
body is required and cannot be empty                    --append ""
positional <text> and --append are mutually exclusive   both passed
```

## Out of scope

- Multiple named slots (e.g. `meta.priorities`, `meta.goals`). Add later
  if a stable need emerges; the `meta` namespace leaves room.
- Per-entity context. Entities already have `note` via
  `edit <id> --note...`. `context` is store-level only.
- Staleness hints (e.g. "context set N days ago"). Could add via
  `meta.context_set_at` later.

## Order of work

1. Schema + `normalizeStore` + mutators + model tests.
2. `contextCmd` + CLI wiring + e2e tests.
3. Render block + render tests.
4. Spec / agent-guide doc updates.
5. Bump 0.9.0. Publish.

## Pivot from working tree

The current uncommitted working tree implements this shape with the verb
`notes` and a flat `Store.notes` field. To match this plan:

- Rename verb: `notes` → `context`.
- Move schema: flat `Store.notes` → `Store.meta.context`. Add
  `StoreMeta`.
- Update `EMPTY_STORE` and `normalizeStore`.
- Switch bare-read from JSON to narrative block-scalar.
- Switch dashboard render from raw prose to `CONTEXT: |` block-scalar.
- Tests TBD; write fresh per spec above.
