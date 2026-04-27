# Plan: JSON storage rewrite

## Goal

Move task storage from per-project markdown files to a single JSON file. JSON-only CLI over a typed entity model, with discriminated subtypes (`ProjectList`, `ActionItem`, `WaitingItem`) that carry only the fields each subtype actually has.

**One canonical shape per entity type, used everywhere** — storage on disk, list buckets, `todo show`, mutation responses. The CLI doesn't reshape entities; it just buckets and filters.

Every entity gets a stable nanoid that never shifts on mutation. The CLI is invoked by an LLM agent (primary) and humans (secondary). Output is always JSON.

## Storage

Default layout:

```
~/.todo/
├── config.json        # CLI config (data-dir override)
└── data/
    └── store.json     # all data
```

- Data file: `<data-dir>/store.json`. Default data-dir is `~/.todo/data/`.
- Resolution order: `TODO_DATA_DIR` env var > `config.json` `dataDir` > default `~/.todo/data/`.
- `~/.todo/config.json` is fixed. Only the data location moves.
- Pretty-printed JSON (2-space indent, sorted keys) for clean diffs.

`config.json`:
```json
{
  "dataDir": "/Users/rupert/Dropbox/todo"
}
```

`store.json`:
```json
{
  "lists": [
    { "id": "Vh8XLm2k", "type": "project", "title": "Telepath",
      "note": null, "created": "2026-04-27T10:14:00Z",
      "active": true, "completed": null, "dropped": null }
  ],
  "items": [
    { "id": "K3jLm9pQ", "type": "action", "list": "Vh8XLm2k",
      "title": "Find guests", "note": null, "created": "2026-04-27T10:14:32Z",
      "active": true, "due": "2026-05-01",
      "completed": null, "dropped": null },
    { "id": "Bn4Gh1Xt", "type": "waiting", "list": "Vh8XLm2k",
      "title": "Cover art from designer", "note": null, "created": "2026-04-27T10:16:00Z",
      "completed": null, "dropped": null }
  ]
}
```

## Schema (storage layer)

```typescript
// Lists ---------------------------------------------------------------

type BaseList = {
  id: string                   // nanoid (8 chars); never reused
  title: string
  note: string | null
  created: string              // ISO timestamp, auto-set on insert
}

type ProjectList = BaseList & {
  type: "project"
  active: boolean
  completed: string | null     // ISO timestamp
  dropped: string | null       // ISO timestamp; mutually exclusive with completed
}

type List = ProjectList         // future: more list subtypes

// Items ---------------------------------------------------------------

type BaseItem = {
  id: string                   // nanoid (8 chars); never reused
  list: string | null          // parent list id; null = standalone
  title: string
  note: string | null
  created: string              // ISO timestamp, auto-set on insert
}

type ActionItem = BaseItem & {
  type: "action"
  active: boolean              // false = deferred (someday/maybe)
  due: string | null           // YYYY-MM-DD
  completed: string | null
  dropped: string | null
}

type WaitingItem = BaseItem & {
  type: "waiting"
  completed: string | null
  dropped: string | null
}

type Item = ActionItem | WaitingItem

// Store ---------------------------------------------------------------

type Store = {
  lists: List[]
  items: Item[]
}

// Config --------------------------------------------------------------

type Config = {
  dataDir: string | null       // null = unset; resolver falls back to default
}

type ResolvedConfig = {
  dataDir: string              // always concrete
  source: "env" | "config" | "default"
}
```

**Per-subtype additions at a glance:**
- `ProjectList` adds: `active`, `completed`, `dropped` (lifecycle)
- `ActionItem` adds: `active`, `due`, `completed`, `dropped`
- `WaitingItem` adds: `completed`, `dropped`

**Invariants:**
- `completed` and `dropped` are mutually exclusive (at most one non-null).
- `WaitingItem` has no `active` flag; the only mutation is into a terminal state.
- `Item.list` references an existing `List.id` or is `null` (standalone).
- `created` is set once, never edited.
- `id` is set once, never edited, never reused.

**IDs:** 8-char nanoids (alphanumeric, URL-safe), generated on insert. Globally unique across the store. Multi-device-safe.

**Refs:** the bare `id`. `todo show <id>` and lifecycle verbs accept any entity id (project, action, waiting) and resolve polymorphically.

## Modules & signatures

The architecture has a clean three-layer cake. **Storage I/O** (`store.ts`) talks to disk; **model** (`model.ts`) is pure data + mutators + bucket helpers; **commands** wire CLI input through the model and persist via storage. No view layer.

### `src/core/config.ts`

```typescript
const CONFIG_PATH: string                    // ${HOME}/.todo/config.json
const DEFAULT_DATA_DIR: string               // ${HOME}/.todo/data

function readConfig(): Config                 // returns { dataDir: null } if file missing
function writeConfig(c: Config): void         // creates ~/.todo/ if missing
function resolveDataDir(): ResolvedConfig     // env > config > default
```

### `src/core/store.ts`

```typescript
function readStore(dataDir: string): Store       // returns { lists: [], items: [] } if file missing; throws on parse error
function writeStore(dataDir: string, store: Store): void  // atomic (tmpfile + rename); JSON 2-space, sorted keys
function newId(): string                          // 8-char nanoid (alphanumeric, URL-safe)
function nowIso(): string                         // ISO 8601, second precision
```

`writeStore` is the single persistence funnel. Pretty-print + sorted keys produce stable diffs.

### `src/core/model.ts`

Pure functions; no I/O, no globals. Every mutator takes the current `Store` and returns `{ store, entity }` — the new store and the affected entity (for command-layer responses).

```typescript
// Lookup
function findList(s: Store, id: string): List | undefined
function findItem(s: Store, id: string): Item | undefined
function findEntity(s: Store, id: string): List | Item | undefined

// Insert
function addProject(s: Store, input: {
  title: string
  note?: string | null
}): { store: Store; entity: ProjectList }

function addAction(s: Store, input: {
  title: string
  active: boolean                 // required at the model layer; CLI maps --active/--deferred
  list?: string | null
  due?: string | null
  note?: string | null
}): { store: Store; entity: ActionItem }

function addWaiting(s: Store, input: {
  title: string
  list?: string | null
  note?: string | null
}): { store: Store; entity: WaitingItem }

// Edit (omit a field = unchanged; null = clear; CLI translates `""` → null on string fields)
function editList(s: Store, id: string, patch: {
  title?: string                  // non-empty
  note?: string | null
}): { store: Store; entity: ProjectList }

function editItem(s: Store, id: string, patch: {
  title?: string
  note?: string | null
  due?: string | null             // only valid on actions
  list?: string | null            // re-parent or detach
}): { store: Store; entity: Item }

// Lifecycle
function setActive(s: Store, id: string, active: boolean): { store: Store; entity: ProjectList | ActionItem }
  // also clears completed/dropped (single verb does double duty: live state + terminal clear)
  // throws InvalidArgument on waiting items
function setCompleted(s: Store, id: string): { store: Store; entity: List | Item }
  // sets completed=now, dropped=null
function setDropped(s: Store, id: string): { store: Store; entity: List | Item }
  // sets dropped=now, completed=null

// Bucket helpers
function liveActions(s: Store): ActionItem[]      // active=true, !terminal, parent active or null
function deferredActions(s: Store): ActionItem[]  // active=false, !terminal, parent active or null
function liveWaiting(s: Store): WaitingItem[]     // !terminal, parent active or null
function activeProjects(s: Store): ProjectList[]  // active=true, !terminal
function deferredProjects(s: Store): ProjectList[]// active=false, !terminal
```

**Validation rules (enforced in mutators, surface as `InvalidArgument`):**
- `addAction`/`editItem` rejects setting `due` on a waiting item.
- `setActive` rejects waiting items (no active flag).
- `editItem` with `list = <id>` rejects unknown ids.
- `addAction`/`addWaiting` with `list = <id>` rejects unknown ids.
- `editList`/`editItem` with all-empty patch raises `NothingToEdit`.

**Cascade:** parent project terminal/active state does NOT cascade to child items in storage. The `live*` bucket helpers just filter by parent state at read time. So `defer`-ing a project hides its actions in `todo list` without mutating them.

### `src/core/ref.ts`

```typescript
function resolveRef(s: Store, ref: string): List | Item   // throws NotFound
```

Bare nanoid lookup across `lists` and `items`. No prefix, no `slug:index` shape.

### `src/core/errors.ts`

```typescript
class DoError extends Error {}
class NotFound extends DoError {}              // unknown id
class NothingToEdit extends DoError {}         // edit with no patch fields
class InvalidArgument extends DoError {}       // type misuse, mutually exclusive flags, unknown parent id, etc.
```

### `src/commands/*`

Every command has the same shape:

```typescript
function commandX(args): string                // returns JSON string for stdout; throws DoError on failure
```

Command bodies:

1. Resolve data-dir via `resolveDataDir()`.
2. `readStore(dataDir)`.
3. Apply input via mutator(s) from `model.ts` (or call bucket helpers for reads).
4. `writeStore(dataDir, newStore)` if mutating.
5. `JSON.stringify(result, null, 2)` and return.

`src/cli.ts` is just commander wiring + a single `try/catch` that prints `DoError.message` to stderr and exits non-zero.

## Command outputs

Every list/show/mutation response is JSON, pretty-printed (2-space indent, sorted keys). Input lines are shown as `$ todo …` with the resulting stdout below.

Sample `store.json` referenced by these examples:

```json
{
  "items": [
    { "id": "K3jLm9pQ", "type": "action", "list": "Vh8XLm2k",
      "title": "Find guests", "note": null,
      "created": "2026-04-27T10:14:32Z",
      "active": true, "due": "2026-05-01",
      "completed": null, "dropped": null },
    { "id": "P7nW3qZb", "type": "action", "list": null,
      "title": "Pick up dry cleaning", "note": null,
      "created": "2026-04-27T10:15:00Z",
      "active": true, "due": null,
      "completed": null, "dropped": null },
    { "id": "M9tBc4xR", "type": "action", "list": null,
      "title": "Read DDIA", "note": null,
      "created": "2026-04-20T08:00:00Z",
      "active": false, "due": null,
      "completed": null, "dropped": null },
    { "id": "Bn4Gh1Xt", "type": "waiting", "list": "Vh8XLm2k",
      "title": "Cover art from designer",
      "note": "Sent brief 2026-04-25.",
      "created": "2026-04-25T16:00:00Z",
      "completed": null, "dropped": null }
  ],
  "lists": [
    { "id": "Vh8XLm2k", "type": "project", "title": "Telepath",
      "note": "Indie thinking tool.",
      "created": "2026-04-01T09:00:00Z",
      "active": true, "completed": null, "dropped": null },
    { "id": "Yk2Lm9wT", "type": "project", "title": "Learn Rust",
      "note": null,
      "created": "2026-03-15T12:30:00Z",
      "active": false, "completed": null, "dropped": null }
  ]
}
```

### `todo list`

```
$ todo list
{
  "active_actions": [
    {
      "active": true,
      "completed": null,
      "created": "2026-04-27T10:14:32Z",
      "due": "2026-05-01",
      "dropped": null,
      "id": "K3jLm9pQ",
      "list": "Vh8XLm2k",
      "note": null,
      "title": "Find guests",
      "type": "action"
    },
    {
      "active": true,
      "completed": null,
      "created": "2026-04-27T10:15:00Z",
      "due": null,
      "dropped": null,
      "id": "P7nW3qZb",
      "list": null,
      "note": null,
      "title": "Pick up dry cleaning",
      "type": "action"
    }
  ],
  "active_projects": [
    {
      "active": true,
      "completed": null,
      "created": "2026-04-01T09:00:00Z",
      "dropped": null,
      "id": "Vh8XLm2k",
      "note": "Indie thinking tool.",
      "title": "Telepath",
      "type": "project"
    }
  ],
  "waiting": [
    {
      "completed": null,
      "created": "2026-04-25T16:00:00Z",
      "dropped": null,
      "id": "Bn4Gh1Xt",
      "list": "Vh8XLm2k",
      "note": "Sent brief 2026-04-25.",
      "title": "Cover art from designer",
      "type": "waiting"
    }
  ]
}
```

(Subsequent examples use `…` for already-shown entities to keep this section readable.)

### `todo list --all`

```
$ todo list --all
{
  "active_actions":    [ K3jLm9pQ, P7nW3qZb ],
  "active_projects":   [ Vh8XLm2k ],
  "deferred_actions":  [ M9tBc4xR ],
  "deferred_projects": [ Yk2Lm9wT ],
  "waiting":           [ Bn4Gh1Xt ]
}
```

(Each entry is the full canonical entity object as in `todo list`.)

### `todo projects list`

```
$ todo projects list
{
  "active_projects":   [ Vh8XLm2k ],
  "deferred_projects": [ Yk2Lm9wT ]
}
```

### `todo show <id>` — project

```
$ todo show Vh8XLm2k
{
  "active": true,
  "completed": null,
  "created": "2026-04-01T09:00:00Z",
  "dropped": null,
  "id": "Vh8XLm2k",
  "note": "Indie thinking tool.",
  "title": "Telepath",
  "type": "project"
}
```

### `todo show <id>` — action

```
$ todo show K3jLm9pQ
{
  "active": true,
  "completed": null,
  "created": "2026-04-27T10:14:32Z",
  "due": "2026-05-01",
  "dropped": null,
  "id": "K3jLm9pQ",
  "list": "Vh8XLm2k",
  "note": null,
  "title": "Find guests",
  "type": "action"
}
```

### `todo show <id>` — waiting

```
$ todo show Bn4Gh1Xt
{
  "completed": null,
  "created": "2026-04-25T16:00:00Z",
  "dropped": null,
  "id": "Bn4Gh1Xt",
  "list": "Vh8XLm2k",
  "note": "Sent brief 2026-04-25.",
  "title": "Cover art from designer",
  "type": "waiting"
}
```

### `todo add` — action

```
$ todo add "Email Steve about Q2 plan" --active --project Vh8XLm2k --due 2026-05-03
{
  "active": true,
  "completed": null,
  "created": "2026-04-27T11:02:14Z",
  "due": "2026-05-03",
  "dropped": null,
  "id": "Z9jK2hNs",
  "list": "Vh8XLm2k",
  "note": null,
  "title": "Email Steve about Q2 plan",
  "type": "action"
}
```

```
$ todo add "Buy headphones" --deferred
{ ...action with active=false, list=null, due=null... }
```

### `todo add --waiting`

```
$ todo add "Tax docs from accountant" --waiting --note "Sent W-2 2026-04-15"
{
  "completed": null,
  "created": "2026-04-27T11:04:00Z",
  "dropped": null,
  "id": "T4rX8mPq",
  "list": null,
  "note": "Sent W-2 2026-04-15",
  "title": "Tax docs from accountant",
  "type": "waiting"
}
```

### `todo edit <id>`

```
$ todo edit K3jLm9pQ --title "Find 3 guests for E14" --due ""
{ ...full action with title updated, due=null, all other fields preserved... }
```

```
$ todo edit P7nW3qZb --project Vh8XLm2k
{ ...P7nW3qZb with list="Vh8XLm2k"... }
```

### `todo projects add`

```
$ todo projects add --title "Q3 launch" --note "Scope tbd."
{
  "active": true,
  "completed": null,
  "created": "2026-04-27T11:10:00Z",
  "dropped": null,
  "id": "F5hQ7nLx",
  "note": "Scope tbd.",
  "title": "Q3 launch",
  "type": "project"
}
```

### `todo projects edit <id>`

```
$ todo projects edit Vh8XLm2k --note ""
{ ...Vh8XLm2k with note=null... }
```

### `todo activate <id>`

```
$ todo activate Yk2Lm9wT
{ ...Yk2Lm9wT with active=true... }

$ todo activate M9tBc4xR
{ ...M9tBc4xR with active=true... }

$ todo activate Bn4Gh1Xt
todo: cannot activate waiting item Bn4Gh1Xt (no active flag)   # stderr
                                                                 # exit 1
```

### `todo defer <id>`

```
$ todo defer Vh8XLm2k
{ ...Vh8XLm2k with active=false... }

$ todo defer K3jLm9pQ
{ ...K3jLm9pQ with active=false... }
```

### `todo complete <id>`

```
$ todo complete K3jLm9pQ
{ ...K3jLm9pQ with completed="2026-04-27T11:18:42Z"... }
```

Works on projects, actions, and waiting items. Sets `completed = nowIso()`. If `dropped` was non-null, it's cleared.

### `todo drop <id>`

```
$ todo drop M9tBc4xR
{ ...M9tBc4xR with dropped="2026-04-27T11:19:08Z"... }
```

### Reactivating a terminal entity

There is no `reopen` verb. Use `activate` or `defer` — both clear the terminal state and set `active` accordingly:

```
$ todo activate K3jLm9pQ           # was completed; now active=true, completed=null, dropped=null
$ todo defer K3jLm9pQ              # was completed; now active=false, completed=null, dropped=null
```

Waiting items have no `active` flag and no resurrection path (see lifecycle section).

### `todo set-data-dir <path>`

```
$ todo set-data-dir /Users/rupert/Dropbox/todo
{
  "dataDir": "/Users/rupert/Dropbox/todo",
  "source": "config"
}
```

Writes `~/.todo/config.json`. Returns the resolved config (so the agent confirms what's now in effect).

### `todo config`

```
$ todo config
{
  "dataDir": "/Users/rupert/.todo/data",
  "source": "default"
}
```

`source` is one of `"env"`, `"config"`, `"default"` — useful for the agent to know whether the user has set anything explicit.

### Errors

Plain text to stderr, non-zero exit. Examples:

```
$ todo show NoSuchId
todo: not found: NoSuchId                    # stderr; exit 1

$ todo edit K3jLm9pQ
todo: nothing to edit                        # stderr; exit 1

$ todo add "Test"
todo: --active, --deferred, or --waiting is required

$ todo add "Test" --active --waiting
todo: --active, --deferred, --waiting are mutually exclusive (got 2)

$ todo add "Test" --waiting --due 2026-05-01
todo: --due is not allowed on waiting items
```

The CLI never prints stack traces unless the error isn't a `DoError` (programmer bug — let it bubble).

## CLI surface

### Reads

```
todo list                          # { active_actions, waiting, active_projects }
todo list --all                    # also { deferred_actions, deferred_projects }
todo projects list                 # { active_projects, deferred_projects }
todo show <id>                     # full entity (polymorphic)
```

### Item creation

```
todo add "<title>" (--active | --deferred | --waiting) [--project <id>] [--due <date>] [--note <text>]
```

Validation:
- **Exactly one** of `--active`, `--deferred`, or `--waiting` is required. Zero or more than one → error.
- `--active` / `--deferred` → action item with `active` set accordingly. `--due` allowed.
- `--waiting` → waiting item. `--due` is rejected.

### Item edit

```
todo edit <id> [--title ...] [--note ...] [--due ...] [--project ...]
```

`--due` only valid on action items. Type is set at creation and immutable.

**Clearing optional fields:** omit a flag to leave it unchanged. Pass `""` to clear:
- `--note ""` clears the note (sets to `null`)
- `--due ""` clears the due date (sets to `null`)
- `--project ""` detaches the item (sets `list` to `null`)
- `--title ""` is rejected (title is required)

Same convention applies to `todo projects edit`: `--note ""` clears.

### Project creation / edit

```
todo projects add --title "<text>" [--note <text>]
todo projects edit <id> [--title ...] [--note ...]
```

Projects default to `active: true` on creation. To deactivate, use `todo defer <id>`.

### Lifecycle (polymorphic on id)

```
todo activate <id>                 # action/project: active=true, completed=null, dropped=null
todo defer <id>                    # action/project: active=false, completed=null, dropped=null
                                   # both reject waiting items (no active flag)
todo complete <id>                 # any: completed=now, dropped=null
todo drop <id>                     # any: dropped=now, completed=null
```

`activate` and `defer` double as the way to bring a completed/dropped action or project back to a live state — the live-vs-deferred decision must be made when reactivating, so the same verb sets it. No separate `reopen` verb.

**Waiting items have no resurrection path.** Once `complete` or `drop` is applied, they're terminal. To track a new "waiting" state for the same thing, create a new waiting item. (This matches GTD instinct: a waiting-for is about a specific outstanding ask; if it comes back, it's a fresh ask.)

### Configuration

```
todo set-data-dir <path>           # writes dataDir to ~/.todo/config.json
todo config                        # prints resolved config (JSON)
```

**Total: 13 commands.**

## Field migrations from existing

| Existing | New | Notes |
|---|---|---|
| `text` | `title` | rename |
| `notes` | `note` | rename, singular |
| `lane: available` | `type: "action"`, `active: true` | type + flag |
| `lane: deferred` | `type: "action"`, `active: false` | someday |
| `lane: waiting` | `type: "waiting"` | first-class type |
| `lane: completed` | `completed: <iso>` set | terminal timestamp |
| `done` | (removed) | derived from `completed != null` |
| `contexts: string[]` | (removed) | dropped entirely; agent puts situational info in title/note |
| `completedAt` | `completed` | rename |
| project slug | project nanoid | slugs gone; titles still human-readable |
| (new) | `id` (nanoid) | stable ID for both lists and items |
| (new) | `created` | ISO timestamp on items |
| (new) | `type` (discriminator) | "project" / "action" / "waiting" |
| (new) | `dropped: <iso>` | new terminal state distinct from completed |
| (new) | `active` (project) | engaged vs paused |

## Code changes

### `src/core/`
- **`config.ts`** (rewritten) — resolves data-dir per the precedence rules. Reads/writes `config.json` for `set-data-dir`.
- **New `store.ts`** — given resolved data-dir, reads/writes `<data-dir>/store.json` with atomic write via tmpfile + rename. Pretty-print + sorted keys. Generates nanoids on insert.
- **Replace `project.ts` with `model.ts`** — schema types (`List`, `Item`, subtypes, `Store`), pure validators, pure mutators (`addProject`, `addAction`, `addWaiting`, `editList`, `editItem`, `setActive`, `setCompleted`, `setDropped`), bucket helpers (`liveActions`, `deferredActions`, `liveWaiting`, `activeProjects`, `deferredProjects`), and lookup helpers (`findList`, `findItem`, `findEntity`). No I/O. See "Modules & signatures".
- **Drop `vault.ts`** entirely.
- **`tasks.ts`** — fold result types into `model.ts`.
- **`ref.ts`** — refs are bare nanoid strings; resolver looks up across `lists` and `items`.
- **`errors.ts`** — keep `NotFound`, `NothingToEdit`, `InvalidArgument`. Drop `MalformedProject`, `InvalidSlug`, `UnknownContext`.
- **`dates.ts`** — unchanged.

### `src/commands/`
- **`list.ts`** — `todo list` (with `--all`).
- **`projects-list.ts`** (or fold into `projects.ts`) — `todo projects list`.
- **`show.ts`** — `todo show <id>`, polymorphic.
- **`add.ts`** — `todo add` for items (action and waiting via flags).
- **`edit.ts`** — `todo edit <id>`.
- **`projects.ts`** — `todo projects add` / `todo projects edit`.
- **`lifecycle.ts`** — `activate`, `defer`, `complete`, `drop` (polymorphic on id).
- **`config.ts`** — `set-data-dir` and `config`.
- (No `contexts.ts`, no `tasks.ts`.)

### `src/cli.ts`
- Drop `--vault` global flag, `set-vault` subcommand.
- Drop the existing `tasks <verb>` and `projects <verb>` verb sets.
- Wire up the new commands above.
- Output is always JSON; remove TTY/color logic.
- Update tagline.

### `src/views/`
- **Deleted entirely.** picocolors/TTY rendering is gone. There is no view layer — output is `JSON.stringify` directly on entities or buckets returned by `core/model.ts`.

## Tests

- **`tests/model.test.ts`** (was `project.test.ts`) — schema validation per subtype, mutators, ID generation, terminal-state mutual exclusion. Drop all markdown-parser tests.
- **Bucket-helper tests** live in `tests/model.test.ts` alongside mutator tests — `liveActions` / `deferredActions` / `liveWaiting` / `activeProjects` / `deferredProjects` filter correctness. No separate `view.test.ts` file.
- **`tests/cli.e2e.test.ts`** — rewritten for new CLI surface (single `todo add`, polymorphic lifecycle verbs, JSON output assertions). Update on-disk reads to parse JSON, drop shift-advisory assertions.
- **`tests/ref.test.ts`** — refs are bare nanoids; resolver checks both `lists` and `items`.
- **`tests/config.test.ts`** — rewrite for `set-data-dir` resolution (env > config > default).
- **`tests/helpers.ts`** — `makeTempVault` → `makeTempDataDir`; sets `TODO_DATA_DIR`.
- **`tests/dates.test.ts`** — unchanged.
- **`tests/tasks.test.ts`** — delete or merge into `model.test.ts`.

## Docs

- **`README.md`** — rewrite. Drop "markdown / Obsidian / wikilinks" language. Show JSON example. Document `~/.todo/data/store.json` and `set-data-dir`. Highlight the type-discriminated entity model and JSON-only output.
- **`docs/spec.md`** — rewrite. Storage section, JSON schema (subtypes), display schemas, CLI surface, ID rules.
- **`docs/cli.md`** — update commands.
- **`skill/SKILL.md`** — populate. Agent-facing: ref shape, entity types, common flows, output JSON shapes for the three list views and show.
- **`docs/plans/task-status-and-notes-preamble.md`** and **`docs/plans/v0.2-implementation-sequence.md`** — leave as historical record.

## Order of work

1. Dependencies: add `nanoid`, drop `picocolors`. Storage primitives: schema types, `core/config.ts`, `core/store.ts` + tests.
2. Mutators and bucket helpers in `core/model.ts` (with validators). Get `tests/model.test.ts` green (mutators + bucket helpers + invariants).
3. CLI commands in `src/commands/` and `src/cli.ts`. Each command: read store → mutate via model → write store → JSON.stringify.
4. End-to-end CLI tests.
5. Delete dead code: markdown parser/serializer, vault module, contexts, picocolors rendering, `set-vault`/`--vault`, lane-related args, the old `tasks` and `projects` verb sets.
6. Rewrite docs and `skill/SKILL.md`.
7. Final pass: `npm test`, manual smoke test.

## Out of scope

- Migration from `.md` files. There is none. Old vaults are abandoned.
- Multiple data stores / vaults (only one data-dir at a time).
- Multi-device merge logic. Nanoids prevent ID collisions but JSON-array merge on simultaneous offline edits is still out of scope; rely on a single writer at a time.
- **Agenda task type.** Future direction — `type: "agenda"` with type-specific fields like `with: string` (person to discuss with). Slots in as a third Item subtype + new flag(s) on `todo add`. Out of scope for this rewrite.
- **Situational tags / contexts (`@errand`, `@home`, etc.).** Removed entirely. If we need them back, add a `where` field to ActionItem or a generic `tags` array — also future. Out of scope.
- **Status filtering on `todo list` (`--completed` / `--dropped`).** Terminal items are intentionally invisible at the list level. To inspect a specific terminal item, `todo show <id>`. If history queries become important, add filters later.
- **Multiple list subtypes** (reading list, watchlist, etc.). Currently only `ProjectList` exists. The base/subtype split makes adding more straightforward later.
