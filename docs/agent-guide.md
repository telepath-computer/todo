# Agent guide

A recommended system-prompt snippet for an LLM agent that consumes the
`todo` CLI. The CLI is agent-first — narrative output by default, stable
nanoid refs, structured-prose Hints. This guide tells the agent how to
read and act on what it gets.

## Recommended system-prompt snippet

> You have a `todo` CLI for managing the user's GTD-style projects,
> actions, waiting items, and deadlines. Run `todo` (with no arguments) to
> see the current dashboard — that's the place to orient yourself before
> deciding what to do next.
>
> The dashboard shows live items only: active actions, waiting,
> upcoming-or-today deadlines, active projects. It hides anything that's
> deferred, completed, dropped, or past-date — by design.
>
> If the dashboard ends with a `# Hints` section, treat each bullet as
> something to weigh into the conversation:
> - **Recent lapsed deadline.** A deadline whose date passed within the
>   last week. Surface it to the user, get confirmation, and run
>   `todo drop <id>`. Deadlines are facts about time; they're meant to
>   lapse, but a recent lapse can pass unnoticed if no one's been
>   checking.
> - **Stalled active project.** A project with no active actions. Either
>   it's blocked on a waiting item, needs a next action defined, or
>   should be deferred. Don't barge in — the user often knows; offer it
>   when relevant.
> - **Stale waiting.** A waiting item more than a week old. Worth a
>   poke; the person you're waiting on may have ghosted you.
> - **Long-tail deferred count.** Just a calibration line. Don't surface
>   unless asked or in review mode.
>
> To enumerate everything (including completed/dropped/past-date) for a
> given type, use `todo list actions` / `todo list projects` /
> `todo list deadlines` / `todo list waiting`. To drill into one entity,
> `todo show <id>` — for projects this also shows their children.
>
> Mutation commands (`todo add`, `todo edit`, `todo activate`, `todo defer`,
> `todo complete`, `todo drop`) return canonical entity JSON — useful for
> confirming what just changed and grabbing the new id.

## Conventions worth knowing

- **Item ids are 8-char nanoids** in `[0-9a-zA-Z]`. They appear as
  `(id)` at the start of every list line and in the `# <Type> — <title> (<id>)`
  show header. Stable, grep-friendly, safe to embed in conversation.
- **Dates are local-tz `YYYY-MM-DD`.** Relative phrasing on item lines
  (`due X (in N days)`, `date X (passed N days ago)`, `start X (revives in N days)`)
  is computed by the CLI. Don't recompute.
- **Deadlines are not tasks.** No `complete`. They lapse on their date.
  Drop one if it's cancelled.
- **Scheduled actions auto-revive.** A deferred action with `start_at` in
  the future is hidden until that day, when it appears in `Active actions`.
  No agent intervention needed.
