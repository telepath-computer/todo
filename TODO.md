# TODO

Prioritised backlog for `td`. Rough buckets; within each, earlier items land first.

## Decide first

- **Rename `projects` → `lists`?** `project` implies a goal-oriented container with an end state. `list` generalises to "TV shows to watch", "books to read", "places to visit", plus current use. Cheap to change now (no meaningful data); expensive later. Either commit to `projects` and live with the naming, or swap before any P1 ships.

## P1 — unblock daily use

- **Sort / group tasks.** `td tasks list` currently prints in vault order (slug asc, then index). Add:
  - `--sort due` — overdue first, then today, then soonest; undated last
  - `--group-by project` (current default, made explicit)
  - Once both work, make "due-aware sort, grouped by project" the default and the implicit options explicit for agents
- **Deferred task state.** Third state beyond open/done — "not actionable right now" (blocked, waiting, someday/maybe). Hidden from default list; surfaced with `--include-deferred` or `--only-deferred`. Storage: likely `[~]` checkbox variant (some Obsidian plugins already recognise it). Needs a verb: probably `td tasks defer <ref>` and have `td tasks edit <ref>` handle state transitions.
- **Project notes (CLI).** `## Notes` sections already round-trip through mutations. Add `td projects notes <slug>` to print; `--append "..."` to add a line. No format change needed — just surfaces what's already there for agents.

## P2 — quality of life

- **Archive projects.** Mark a project as archived (done or dormant, worth keeping for ref stability and history). Frontmatter `archived: true`. Hidden from default `projects list` and `tasks list`; surfaced with `--archived` or `--all`. Verbs: `td projects archive <slug>` / `td projects unarchive <slug>`.
- **Star projects (today shortlist).** Pin projects currently in focus. Frontmatter `starred: true`; verbs `td projects star/unstar <slug>`. `td projects list --starred` and `td tasks list --starred` for quick focused view. (An alternative — a dedicated `today` slug — is less flexible.)

## P3 — later

- **Task notes.** Multi-line notes attached to a single task. Requires relaxing the `## Tasks` rule (currently: checkbox lines only). Likely form: indented sub-lines under a task; parser learns to associate them. Only worth it if task-level richness is a real gap in practice.
- **Slug rename.** `td projects rename <old> <new>` — renames file, rewrites refs. Needs its own shift-note story (every ref to that project moves).

## Open questions

- Three states or more? Deferred covers most; `cancelled` is nice for history but distinct from `done`.
- Does `starred` belong on tasks too, not just projects?
- When archived/deferred items are included via `--all`, where do they sort — end of list, or mixed in by urgency?
- If we rename to `lists`, what replaces "task"? Keep `task`, or go fully generic (`item`)?
