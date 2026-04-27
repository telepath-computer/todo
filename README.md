# @telepath-computer/todo

A GTD-style task and project CLI over structured markdown files. Each project is one `.md` file; tasks live in `## Available` / `## Waiting` / `## Deferred` sections; completed work archives under `## Completed`. The format is hand-editable in any markdown editor (Obsidian-friendly), and the CLI mutates files in place — designed so LLM agents can list, add, and complete tasks reliably without grepping freeform notes.

## Install

```sh
npm install -g @telepath-computer/todo
```

## Quick start

```sh
# Point todo at a folder of project files
todo set-vault ~/notes/todo

# Create a project, add tasks, mark them done
todo projects add podcast --title "The Podcast" --notes "A weekly show."
todo tasks add --title "Write release notes" --project podcast --due 2026-05-01
todo tasks add --title "Pick up milk" --project podcast --context errand
todo tasks add --title "Reply from Sam" --project podcast --waiting

# See what's on your plate (cross-project)
todo list

# Mark something done — moves to ## Completed
todo tasks complete podcast#1
```

## What gets stored

```markdown
---
title: "The Podcast"
---

A weekly show.

## Available

- [ ] Pick up milk @errand
- [ ] Write release notes !2026-05-01

## Waiting

- [ ] Reply from Sam

## Completed

2026-05-01:

- [x] Set up RSS feed
```

The format is hand-editable; `todo` mutates these files in place.

## Commands

- `todo list [--all]` — cross-project dashboard.
- `todo projects list | add | show | edit | remove` — project-level operations.
- `todo tasks list [--available|--waiting|--deferred|--all] [--project <slug>]` — list tasks (default = Available + Waiting).
- `todo tasks add | edit | show | complete | uncomplete | remove` — task operations.
  - Lane flags: `--available` / `--waiting` / `--deferred` (mutually exclusive; default `--available`).
  - `--context <name>` (repeatable, full-replace on `edit`).
  - `--due <date>` accepts `YYYY-MM-DD` or natural language (`tomorrow`, `next friday`).
- `todo set-vault <path>` — point the CLI at a vault.

Full spec: [docs/spec.md](./docs/spec.md).

## Refs

Tasks have stable refs of the form `<slug>#<index>` (e.g. `podcast#3`). Refs are 1-based positions across the three lane sections in document order, generated on every read. Mutations may shift refs — when this happens the CLI prints a one-line shift note so you (or your agent) know to re-list before the next mutation.

Note: `#` is a comment character in bash/zsh, so quote refs interactively (`'podcast#3'`). Agents calling via argv arrays don't need to.

## License

MIT.
