# todo

A CLI for managing GTD-style projects and their next actions over structured markdown files. Designed to be called by LLM agents acting as a personal assistant, so they can reliably list, add, and complete actions without having to grep and interpret freeform notes.

## Storage format

State lives as markdown files on disk. The CLI reads and mutates them in place.

Markdown is chosen over JSON or a database because the files need to sit alongside the user's existing notes in an Obsidian-style vault — rendering in place, supporting `[[wikilinks]]`, and remaining hand-editable so a box can be checked or a note added without the CLI. Freeform project prose lives naturally in the body rather than as a stringified JSON field, and since agents only mutate files through CLI verbs, structured parse-ability matters less than vault integration.

### Directory layout

The CLI operates against a single vault directory. Project files (one per project) live directly at the root of the vault.

```
<vault>/
├── launch-telepath-v0.3.md
├── tax-return-2025.md
└── ...                    (other user notes can live here freely; `todo` ignores anything that isn't a valid project slug `.md`)
```

One file per project. Filename (without `.md`) is the slug — the project's stable handle. The vault is resolved from `--vault` flag, the user config, or the default at `~/.todo/default/` — see [Configuration](#configuration).

## Configuration

The CLI has an app home at `~/.todo/` which contains the machine-local config file and, by default, the vault itself.

```
~/.todo/
├── config.json          machine-local app config (not synced)
└── default/             default vault — exists only if no external vault is configured
```

### App config — `~/.todo/config.json`

Machine-local. Tells the CLI where the vault is.

```json
{
  "vault": "/Users/rupert/Workspace/user/Notes"
}
```

Keys:

- `vault` (optional) — absolute path to an external vault. When absent, the default vault at `~/.todo/default/` is used.

### Resolution

The vault is resolved in this order:

1. `--vault <path>` flag, if passed. The path must exist.
2. `vault` key in `~/.todo/config.json`, if set. The path must exist.
3. Default: `~/.todo/default/`, auto-created on first write.

### Setting the vault

`todo set-vault <path>` writes the `vault` key to `~/.todo/config.json`. Details under [CLI](#cli) below.

### Auto-creation

| Path | When created |
|---|---|
| `~/.todo/` | Auto — whenever the CLI needs to read/write config or the default vault. |
| `~/.todo/config.json` | Only when `todo set-vault` is called. |
| `~/.todo/default/` | Auto on first write if no `vault` is configured. |
| External vault (user-set path) | Must already exist; the CLI errors out with `vault not found: <path>` if it doesn't. |

## Project file structure

```markdown
---
title: Launch Telepath v0.3
---

A weekly show on agent tooling.
Hosted by Rupert.

## Available

- [ ] Write the release notes !2026-05-01
  Remember to include the migration section.
  Tag Rupert for review before shipping.
- [ ] Record the demo video
- [x] Draft the changelog

## Waiting

- [ ] Reply from Sam

## Deferred

- [ ] Auto-transcripts some day

## Resources

Other body sections (after the lane sections) are preserved verbatim and ignored by the CLI.
```

**Rules:**

- **Slug format.** A slug matches `^[a-z0-9][a-z0-9.-]*$` — lowercase letters, digits, dots, and hyphens, starting with an alphanumeric character. The slug is the filename (without `.md`) and the stable handle for a project. The `#` character is reserved as the ref separator and must not appear in a slug.
- **Frontmatter** contains `title:`. The filename is the project's stable handle; the title is for display. Other frontmatter keys are preserved verbatim.
- **Three lane sections** — `## Available`, `## Waiting`, `## Deferred` — are machine-managed. Each contains *only* checkbox lines (`- [ ]` or `- [x]`) and their optional indented notes (see below), plus blank lines. Each section ends at the next heading of equal or higher level (`##` or `#`), or end of file. `## Available` is always emitted (heading-only when empty); `## Waiting` and `## Deferred` are emitted only when they contain at least one item, and disappear when the last item moves out.
- **Lanes** correspond to GTD-style task handling: **Available** = actionable now (the default); **Waiting** = blocked on someone or something; **Deferred** = someday/maybe. The lane is determined by which section the task lives under. `todo tasks add` and `todo tasks edit` accept `--available` / `--waiting` / `--deferred` flags to set or change a task's lane.
- **`## Completed` archive section** is optional and lives at the bottom (after the lane sections). Inside it, items are grouped under `YYYY-MM-DD:` date labels — plain date lines with a trailing colon, not markdown headings. `todo tasks complete <ref>` moves an item from its lane into `## Completed` under today's date label (creating the section and label if needed). `todo tasks uncomplete <ref>` moves it back to `## Available`. Completed items are excluded from `todo tasks list` and `todo projects show` — Completed is archival only. Empty date labels are removed on write; the section disappears when no completed items remain.
- **Project notes** live in the **preamble** — markdown between the closing `---` of frontmatter and the `## Available` heading. The CLI reads/writes the preamble through `todo projects add/edit --notes "..."` and renders it via `todo projects show`. To prevent user prose from accidentally opening a section, any `#` at the start of a preamble line is escaped to `\#` on write and unescaped on read.
- **Due dates.** A task may carry a due date as a trailing `!YYYY-MM-DD` token on the line, e.g. `- [ ] Write the release notes !2026-05-01`. The token is optional; when present it is stripped from the displayed task text and rendered as a distinct field. The date must be a literal `YYYY-MM-DD` (no range or time).
- **Contexts.** A task may carry zero or more **context tags** as trailing `@<string>` tokens, e.g. `- [ ] Pick up milk @errand @home`. `<string>` is any non-whitespace sequence — including characters like `:` (so `@agenda:isa` and `@agenda:` are valid contexts named `agenda:isa` and `agenda:` respectively). Contexts are emitted alphabetically. The CLI accepts repeated `--context <name>` flags on `todo tasks add` (initial set) and `todo tasks edit` (full replacement; pass `--context ""` once to clear).
- **Task notes.** A task may have multi-line notes attached as indented continuation lines immediately following the checkbox line, e.g.:

  ```
  - [ ] Write the release notes !2026-05-01
    Remember to include the migration section.
    Tag Rupert for review before shipping.
  ```

  Any line with a 2-space leading indent following a task is part of that task's notes, until the next `- [ ]`/`- [x]` at zero indent or the end of the section. Leading and trailing blank lines within notes are trimmed. Plain markdown — no special sigil — so Obsidian renders them as continuation of the list item.
- **Task references** are of the form `<slug>#<index>` (e.g. `launch-telepath-v0.3#2`), where `<index>` is the 1-based position across the project's three managed lane sections (`## Available`, `## Waiting`, `## Deferred`) in document order, counting checked and unchecked alike. References are generated by the CLI on every read, not stored in the file. They are stable within a single read→write cycle; agents should always list before mutating, since removing a task or changing its lane shifts subsequent indexes. Note: `#` is a comment character in bash/zsh, so interactive shell use requires quoting the ref (e.g. `'launch-telepath-v0.3#2'`). Agents calling the CLI via argv arrays are unaffected.
- **Preservation.** The CLI manages the three lane sections (`## Available`, `## Waiting`, `## Deferred`) and the `## Notes` section. All other content — frontmatter keys it doesn't manage, other headings, body prose, blank lines — is preserved verbatim. It does not reflow, reformat, or reorder surrounding markdown.

## CLI

Every command accepts `--vault <path>` to override the configured vault for that invocation.

On failure, commands write a line of the form `error: <description>` to stderr and exit with a non-zero status. Success output goes to stdout.

### Presentation

Output is colored when stdout is a TTY, and plain text when piped or redirected (so agents consuming stdout get clean output by default).

- **Checkboxes** (`[ ]` and `[x]`) render in **blue**.
- **Refs** (`[<slug>#<index>]`) render dim.
- **Due dates** (rendered as `!YYYY-MM-DD`, mirroring storage) are colored by urgency: red when overdue (before today), yellow when due today, dim otherwise.
- **Notes indicator** — when a task has notes attached, a dim `…` is appended after the due-date slot and before the ref. It signals "there's more; use `todo tasks show <ref>` to see it." Absent when the task has no notes.
- **Error messages** render red.
- **Empty-state hints** (see below) render dim.
- **Shift notes** (see below) render dim and italic.
- Everything else renders in the terminal's default color.

#### Empty results

When a list command produces no rows and stdout is a TTY, the CLI prints a dim, single-line guidance hint on stdout instead of blank output. When stdout is not a TTY, empty lists emit no output so agents parsing stdout get clean zero-row results. See each list command below for its exact hint text.

#### Shift notes

Mutations that change existing refs (`tasks remove` when the removed task wasn't last; `tasks edit --project` always — and with a source-project shift unless the moved task was last) append a dim, italic advisory line on stdout after the primary result, separated by a blank line:

```
[ ] Record the demo video [launch-telepath-v0.3#2]

Note: refs after #2 in 'launch-telepath-v0.3' have shifted down — re-list before further edits.
```

The note is omitted when no existing ref was affected. Refs are generated per read, so agents should re-list any project whose refs shifted before issuing further ref-bearing commands.

### `todo list [--all]`

Cross-project dashboard. Reads every project in the vault and prints three sections (four with `--all`):

- **Tasks:** — Available items across every project.
- **Waiting:** — Waiting items across every project.
- **Deferred:** — only with `--all` — Deferred items across every project.
- **Projects:** — every project, in the same format as `todo projects list`.

Each item shows its full ref (`[<slug>#<index>]`) so it's actionable directly from the dashboard. Completed items are excluded entirely (Completed is archival only). With an empty vault, prints a dim guidance hint (TTY) or empty output (piped).

### Setup

#### `todo set-vault <path>`

Sets the default vault by writing `vault: <path>` to `~/.todo/config.json`. The path is resolved to absolute form and must exist. Creates `~/.todo/` and `config.json` if needed.

```
$ todo set-vault ~/Workspace/user/Notes
vault: /Users/rupert/Workspace/user/Notes

$ todo set-vault .
vault: /Users/rupert/Workspace/user/Notes
```

Errors:

```
$ todo set-vault /does/not/exist
error: vault not found: /does/not/exist
```

### Projects

#### `todo projects list`

Prints every project in the vault.

```
$ todo projects list
launch-telepath-v0.3  Launch Telepath v0.3
tax-return-2025       Tax Return 2025
```

Empty result (TTY only; dim):

```
$ todo projects list
No projects. Create one with: todo projects add <slug>
```

#### `todo projects add <slug> [--title "<text>"] [--notes "<text>"]`

Creates `<slug>.md` inside the projects directory with frontmatter and an empty `## Available` section. `--title` sets the frontmatter title (defaults to `<slug>`). `--notes` seeds an initial `## Notes` section. Errors if a project with that slug already exists.

```
$ todo projects add podcast --title "The Podcast"
Created new project.

id: podcast
title: The Podcast
```

Errors:

```
$ todo projects add podcast
error: project 'podcast' already exists

$ todo projects add "Launch Telepath"
error: invalid slug 'Launch Telepath': must match [a-z0-9][a-z0-9.-]*
```

#### `todo projects show <slug>`

Prints full project detail: title and slug header, notes (if any), and every incomplete task across the three lanes — Available (context-grouped, no heading), then bold-headed `Waiting:` and `Deferred:` blocks. Completed items are excluded (Completed is archival; use `todo tasks list --deferred` etc. for lane-specific views).

```
$ todo projects show podcast
✳ The Podcast                                                           [podcast]

A weekly show on agent tooling. Hosted by Rupert.

[ ] Ship pilot !2026-05-01 … [podcast#1]
[ ] Find guests [podcast#2]

Waiting:

[ ] Cover art from designer [podcast#3]

Deferred:

[ ] Sponsorship deck [podcast#4]
```

Lanes with no items are omitted. If there are no notes, the notes line is omitted entirely. If the project has no incomplete tasks at all, only the header (and notes, if any) is printed.

Errors:

```
$ todo projects show ghost
error: project 'ghost' not found
```

#### `todo projects edit <slug> [--title "<text>"] [--notes "<text>"]`

Edits one or more fields of a project. At least one flag must be given.

- `--title <text>` rewrites the frontmatter `title` in place. Other frontmatter keys are preserved verbatim; if no `title:` line exists, one is inserted.
- `--notes <text>` replaces the `## Notes` section body. Pass `--notes ""` to remove the section entirely. Other body sections (e.g. `## Resources`) are left untouched.

```
$ todo projects edit podcast --title "The Podcast" --notes "A weekly show."
Updated project.

id: podcast
title: The Podcast
```

Errors:

```
$ todo projects edit ghost --title "x"
error: project 'ghost' not found

$ todo projects edit podcast
error: nothing to edit: pass at least one of --title, --notes
```

#### `todo projects remove <slug>`

Deletes the project file.

```
$ todo projects remove podcast
Removed project: podcast.
```

Errors:

```
$ todo projects remove nonexistent
error: project 'nonexistent' not found
```

### Tasks

Task references have the form `<slug>#<index>` (e.g. `launch-telepath-v0.3#2`). The CLI generates them on every read from each task's 1-based position across the project's three managed lane sections (`## Available`, `## Waiting`, `## Deferred`) in document order.

#### `todo tasks list [--project <slug>] [--available | --waiting | --deferred | --all]`

Prints every task with its ref, state, text, and optional due date. Without `--project`, lists every task across every project in the vault.

**Lane filtering.** By default the listing shows Available + Waiting items (the actionable lanes). Pass `--available`, `--waiting`, or `--deferred` to filter to a single lane, or `--all` to include all three. Multiple lane flags can be combined.

```
$ todo tasks list
[ ] Write the release notes !2026-05-01 … [launch-telepath-v0.3#1]
[ ] Record the demo video [launch-telepath-v0.3#2]
[x] Draft the changelog [launch-telepath-v0.3#3]
[ ] Collect receipts [tax-return-2025#1]
```

The `…` after `!2026-05-01` indicates the first task has attached notes. Use `todo tasks show 'launch-telepath-v0.3#1'` to read them.

```
$ todo tasks list --project launch-telepath-v0.3
[ ] Write the release notes !2026-05-01 … [launch-telepath-v0.3#1]
[ ] Record the demo video [launch-telepath-v0.3#2]
[x] Draft the changelog [launch-telepath-v0.3#3]
```

Empty results (TTY only; dim):

```
$ todo tasks list
No tasks. Start by creating a project: todo projects add <slug>
```

```
$ todo tasks list --project launch-telepath-v0.3
No tasks in 'launch-telepath-v0.3'. Add one with: todo tasks add --title "..." --project launch-telepath-v0.3
```

Errors:

```
$ todo tasks list --project nonexistent
error: project 'nonexistent' not found
```

#### `todo tasks add --title "<text>" --project <slug> [--due <date>] [--notes "<text>"]`

Appends a task to the end of the project's `## Available` section. Prints the new task's ref and content.

`--due` sets a due date. The value can be a literal `YYYY-MM-DD` or a natural-language expression like `today`, `tomorrow`, `next friday`, `may 1`, `may1`, or `in 3 days`; ambiguous month/day expressions resolve to the next upcoming date (e.g. `may 1` when asked in June returns next year's May 1). The resolved date is stored as a trailing `!YYYY-MM-DD` token on the checkbox line.

`--notes` attaches multi-line notes to the task (use `\n` in shells that support C-string escapes, or a heredoc). Notes are stored as indented continuation lines under the checkbox line; see [task notes](#project-file-structure).

```
$ todo tasks add --title "Publish the blog post" --project launch-telepath-v0.3
[ ] Publish the blog post [launch-telepath-v0.3#4]

$ todo tasks add --title "Write the release notes" --project launch-telepath-v0.3 --due 2026-05-01 --notes "Include migration section. Tag Rupert for review."
[ ] Write the release notes !2026-05-01 … [launch-telepath-v0.3#5]
```

Errors:

```
$ todo tasks add --title "Do thing" --project nonexistent
error: project 'nonexistent' not found

$ todo tasks add --title "Do thing" --project launch-telepath-v0.3 --due asdfghjkl
error: invalid date 'asdfghjkl': expected YYYY-MM-DD
```

#### `todo tasks show <ref>`

Prints the task's full state, including its notes (if any). The task line matches `todo tasks list` formatting minus the `…` indicator (since notes are now shown inline).

```
$ todo tasks show 'launch-telepath-v0.3#5'
[ ] Write the release notes !2026-05-01 [launch-telepath-v0.3#5]

Include migration section.
Tag Rupert for review.
```

If the task has no notes, only the task line is printed.

Errors: same modes as `todo tasks complete` (`invalid ref`, `project '<slug>' not found`, `index out of range`).

#### `todo tasks complete <ref>`

Changes `[ ]` to `[x]` on the referenced task. Idempotent if the task is already complete.

```
$ todo tasks complete 'launch-telepath-v0.3#1'
[x] Write the release notes !2026-05-01 [launch-telepath-v0.3#1]
```

Errors:

```
$ todo tasks complete 'bad-ref'
error: invalid ref 'bad-ref': expected <slug>#<index>

$ todo tasks complete 'nonexistent#1'
error: project 'nonexistent' not found

$ todo tasks complete 'launch-telepath-v0.3#99'
error: index 99 out of range (project 'launch-telepath-v0.3' has 3 tasks)
```

#### `todo tasks uncomplete <ref>`

Changes `[x]` to `[ ]`. Idempotent if the task is already incomplete.

```
$ todo tasks uncomplete 'launch-telepath-v0.3#1'
[ ] Write the release notes !2026-05-01 [launch-telepath-v0.3#1]
```

Errors: same modes as `todo tasks complete`.

#### `todo tasks edit <ref> [--title <text>] [--due <date>] [--project <slug>] [--notes <text>]`

Edits one or more fields of a task. At least one flag must be given.

- `--title <text>` replaces the task text.
- `--due <date>` sets a due date. Accepts `YYYY-MM-DD` or a natural-language expression (see `todo tasks add` above). Pass `--due ""` to clear an existing due date.
- `--project <slug>` moves the task to another project. The task is removed from the source project and appended to the end of the target project's `## Available` section, producing a new ref. The task's notes travel with it.
- `--notes <text>` replaces the task's attached notes. Pass `--notes ""` to remove them entirely.

On success, prints the task in its new state (with its current ref, which may have changed if `--project` moved it) followed by a [shift note](#shift-notes) when any existing refs were affected.

```
$ todo tasks edit 'launch-telepath-v0.3#1' --due 2026-05-01
[ ] Write the release notes !2026-05-01 [launch-telepath-v0.3#1]

$ todo tasks edit 'launch-telepath-v0.3#2' --title "Record and edit demo video"
[ ] Record and edit demo video [launch-telepath-v0.3#2]

$ todo tasks edit 'launch-telepath-v0.3#1' --notes "Include the migration section."
[ ] Write the release notes !2026-05-01 … [launch-telepath-v0.3#1]

$ todo tasks edit 'launch-telepath-v0.3#1' --project tax-return-2025
[ ] Write the release notes !2026-05-01 … [tax-return-2025#2]

Note: moved from 'launch-telepath-v0.3'; refs after #1 in 'launch-telepath-v0.3' have shifted down — re-list before further edits.
```

Errors:

```
$ todo tasks edit 'launch-telepath-v0.3#1'
error: nothing to edit: pass at least one of --title, --due, --project

$ todo tasks edit 'launch-telepath-v0.3#1' --due asdfghjkl
error: invalid date 'asdfghjkl': expected YYYY-MM-DD

$ todo tasks edit 'launch-telepath-v0.3#1' --project nonexistent
error: project 'nonexistent' not found
```

Plus the common modes: `invalid ref`, `project '<slug>' not found` (source), and `index out of range`.

#### `todo tasks remove <ref>`

Deletes the referenced task line. Subsequent tasks in the project shift up by one index; a [shift note](#shift-notes) is appended unless the removed task was last.

```
$ todo tasks remove 'launch-telepath-v0.3#2'
[ ] Record the demo video [launch-telepath-v0.3#2]

Note: refs after #2 in 'launch-telepath-v0.3' have shifted down — re-list before further edits.
```

Errors: same modes as `todo tasks complete`.
