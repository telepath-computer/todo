# Agent guide

A recommended system-prompt snippet for an LLM agent that consumes the
`todo` CLI. The CLI is agent-first — read commands emit YAML-like
key/value blocks with stable nanoid refs; mutations return canonical
entity JSON. This guide tells the agent how to read and act on what it
gets.

## Recommended system-prompt snippet

> You have a `todo` CLI for managing the user's GTD-style projects,
> actions, waiting items, and deadlines. Run `todo` (with no arguments) to
> see the current dashboard — that's the place to orient yourself before
> deciding what to do next.
>
> The dashboard prints `SECTION [N]:` headings (active actions, waiting,
> deadlines, active projects) followed by per-item blocks of `- key: value`
> lines. Live items only — anything deferred, completed, dropped, or
> past-date is hidden by design.
>
> If the dashboard ends with a `HINTS:` section, treat each bullet as
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
> `todo show <id>` — for projects this also shows their children grouped
> by `ACTIVE ACTIONS`, `DEFERRED ACTIONS`, `WAITING`, `DEADLINES`.
> `todo show` does not surface Hints; that's a dashboard-only signal.
>
> Mutation commands (`todo add`, `todo edit`, `todo activate`, `todo defer`,
> `todo complete`, `todo drop`) return canonical entity JSON — useful for
> confirming what just changed and grabbing the new id.

## Conventions worth knowing

- **Item ids are 8-char nanoids** in `[0-9a-zA-Z]`. They appear as
  `id: <nanoid>` at the top of every block, in the `<TYPE>: "<title>" [<id>]`
  show header, and in inline refs like `project: <Title> [<id>]`.
  Stable, grep-friendly, safe to embed in conversation.
- **Dates are local-tz `YYYY-MM-DD`.** Relative phrasing on date fields
  (`due: 2026-04-28 (tomorrow)`, `date: 2026-09-30 (in 156 days)`,
  `start: 2026-05-04 (revives in 7 days)`) is computed by the CLI.
  Don't recompute.
- **Status is implicit on the dashboard** (the bucket already says it).
  In `todo list <type>` output, every block carries a `status:` field
  because the listing mixes statuses.
- **Deadlines are not tasks.** No `complete`. They lapse on their date.
  Drop one if it's cancelled.
- **Scheduled actions auto-revive.** A deferred action with `start_at`
  in the future is hidden until that day, when it appears under
  `ACTIVE ACTIONS` on the dashboard. No agent intervention needed.
