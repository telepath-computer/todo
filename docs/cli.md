# CLI implementation

Implementation notes for the `do` CLI. The user-facing surface is defined in [spec.md](./spec.md); this file records the chosen stack, architecture, and conventions.

## Stack

- **Language:** Node.js (TypeScript).
- **Argument parsing:** [`commander`](https://www.npmjs.com/package/commander). Standard, handles nested subcommands (`todo projects list`, `todo tasks complete <ref>`) cleanly, low ceremony.
- **Colors:** [`picocolors`](https://www.npmjs.com/package/picocolors). ~15× smaller than `chalk`, same API shape, and auto-detects TTY so colors are stripped when stdout is piped or redirected.
- **No UI framework.** Ink, blessed, clack, oclif etc. are deliberately avoided: the CLI is agent-facing, and interactive/reactive UI output fights against clean stdout parsing.

## Architecture

The codebase is organised into three layers, strictly separated:

### 1. Core (operations)

Pure functional modules over markdown files. They read and mutate project files and return structured data. They don't format strings, don't print, don't know about colors.

Three modules:

**`project.ts` — owns the file format.**

Parses and serialises a project markdown file: frontmatter, the `## Tasks` section, and everything else. It's the *only* place that knows how bytes on disk become a `Project` and vice versa. It preserves unknown frontmatter keys and all body content outside `## Tasks` verbatim.

```ts
type Project = {
  slug: string                           // from filename
  title: string                          // from frontmatter
  tasks: { done: boolean; text: string }[]  // parsed from ## Tasks
  // plus whatever is needed internally to round-trip preservation
}

readProject(vault, slug): Project
writeProject(vault, project): void
createProject(vault, slug, title?): Project
removeProject(vault, slug): Project
listProjectSlugs(vault): string[]
```

**`tasks.ts` — owns action-level semantics.**

Each mutation is a complete read-modify-write cycle that goes *through* `project.ts`. `tasks.ts` never touches files directly. Functions return the affected action with enough info for the view layer to format it (slug + 1-based index + done + text).

```ts
type TaskResult = { slug: string; index: number; done: boolean; text: string }

listTasks(vault, projectSlug?): TaskResult[]
addTask(vault, projectSlug, text): TaskResult
completeTask(vault, ref): TaskResult
uncompleteTask(vault, ref): TaskResult
removeTask(vault, ref): TaskResult
```

A typical implementation (sketch):

```ts
function completeTask(vault, ref) {
  const { slug, index } = parseRef(ref)          // from ref.ts
  const project = readProject(vault, slug)       // project.ts
  if (index < 1 || index > project.tasks.length) throw new IndexOutOfRange(...)
  project.tasks[index - 1].done = true
  writeProject(vault, project)                   // project.ts
  const task = project.tasks[index - 1]
  return { slug, index, done: task.done, text: task.text }
}
```

**`ref.ts` — owns the ref wire format.**

```ts
parseRef(ref: string): { slug: string; index: number }   // throws InvalidRef
formatRef(slug: string, index: number): string
```

**Ownership discipline:**

- `project.ts` is the only module that reads or writes files. It knows the markdown format.
- `tasks.ts` calls `project.ts` functions; it doesn't know the format, only that projects have a `tasks` array.
- `ref.ts` is standalone; both `tasks.ts` and `views/` import it.
- Dependencies flow in one direction: `ref.ts` ← `project.ts` ← `tasks.ts`. No circular imports.

Errors throw typed exceptions (e.g. `ProjectNotFound`, `ProjectAlreadyExists`, `InvalidSlug`, `InvalidRef`, `IndexOutOfRange`) with a stable `code` field so the command layer can map them to `error: ...` messages without string-matching.

### 2. Views (renderers)

Pure functions that take structured data and return strings. This is where color is applied. Views are **composable**: small atom views combine into larger composite views.

```ts
// Atoms — render one small piece
renderCheckbox(done: boolean): string          // "[ ]" or "[x]", blue
renderRef(ref: string): string                 // "[launch-telepath#1]", dim
renderError(message: string): string           // "error: ...", red

// Composites — build on atoms
renderTask(task: Task): string                 // "[ ] text [ref]"
renderTaskList(tasks: Task[]): string          // joined renderTasks
renderProject(project: Project): string        // "slug  title"
renderProjectList(projects: Project[]): string // joined renderProjects
```

Rules for views:

- Pure: same input → same output. No file I/O, no side effects.
- Return strings, never print. Commands decide where the string goes.
- Composition is the primary extension point: a new view is built from existing atoms.
- Never embed color logic in the core layer.

This separation means a future alternate renderer (JSON, HTML, plain-no-color) is a matter of writing a parallel set of view functions — the core stays untouched.

### 3. Commands

Thin glue. Each command is a commander action handler that:

1. Resolves the vault (flag → user config → error).
2. Calls one or more core operations.
3. Passes the result to the appropriate view function.
4. Writes the view output to stdout, or a rendered error to stderr on exception.

Commands should contain no business logic and no formatting — just wiring.

## Colors

Applied only when stdout is a TTY (`picocolors` handles the check automatically).

| Element | Color |
|---|---|
| Checkboxes (`[ ]`, `[x]`) | blue |
| Refs (`[<slug>#<index>]`) | dim |
| Error messages | red |
| Everything else | default |

## Structure (suggested)

```
do/
├── src/
│   ├── cli.ts                 entry point, commander wiring
│   ├── commands/              one file per verb group, thin glue
│   │   ├── projects.ts        list / add / remove
│   │   ├── tasks.ts           list / add / complete / uncomplete / remove
│   │   └── config.ts          set-vault
│   ├── core/                  operations, pure-ish (file I/O but no formatting)
│   │   ├── config.ts          resolves vault from flag + user config + default; reads/writes ~/.td/config.json
│   │   ├── vault.ts           reads .td.json, knows where projects live
│   │   ├── project.ts         parse/serialize project markdown files
│   │   ├── tasks.ts           task operations
│   │   ├── ref.ts             parse/format <slug>#<index>
│   │   └── errors.ts          typed exception classes
│   └── views/                 pure string formatters, composable
│       ├── atoms.ts           checkbox, ref, error
│       ├── task.ts            single task + list
│       └── project.ts         single project + list
└── package.json
```

The directory shape is a suggestion. The three-layer discipline (core / views / commands) is not — it's what makes adding a new verb or a new output format a local change.
