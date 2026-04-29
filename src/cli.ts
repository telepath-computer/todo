#!/usr/bin/env node
import { Command } from 'commander'
import {
  addActionCmd,
  addDeadlineCmd,
  addProjectCmd,
  addWaitingCmd,
} from './commands/add.js'
import { addMemoCmd } from './commands/addMemo.js'
import { configCmd } from './commands/config.js'
import { editCmd } from './commands/edit.js'
import {
  activateCmd,
  completeCmd,
  deferCmd,
  dropCmd,
} from './commands/lifecycle.js'
import { dashboardCmd } from './commands/dashboard.js'
import { listCmd } from './commands/list.js'
import { reviewCmd } from './commands/review.js'
import { showCmd } from './commands/show.js'
import { DoError } from './core/errors.js'

function run(fn: () => string): void {
  try {
    const out = fn()
    if (out) process.stdout.write(out + '\n')
  } catch (err) {
    if (err instanceof DoError) {
      process.stderr.write(`todo: ${err.message}\n`)
      process.exit(1)
    }
    throw err
  }
}

const program = new Command('todo')
program
  .description(
    'GTD-style task and project CLI with JSON storage. Agent-first. ' +
      'Run with no command to see the dashboard (active items + Hints).',
  )
  .helpOption('-h, --help', 'show help')
  .allowExcessArguments(false)
  .action(() => {
    run(() => dashboardCmd())
  })

program
  .command('list <type>')
  .description(
    'List every item of a given type, regardless of status ' +
      '(actions, projects, deadlines, waiting, memo). Includes completed/dropped/past-date.',
  )
  .action((type: string) => {
    run(() => listCmd(type))
  })

program
  .command('review')
  .description('Weekly sweep: memos, live and deferred work, deadlines, projects, and actionable hints')
  .action(() => {
    run(() => reviewCmd())
  })

program
  .command('show <id>')
  .description('Show a single entity (project, action, waiting, deadline, or memo) by id')
  .action((id: string) => {
    run(() => showCmd(id))
  })

const add = program.command('add').description('Create a new entity')

add
  .command('project <title>')
  .description('Create a project')
  .option('--note <text>', 'attach a note')
  .option('--parent <id>', 'attach to a root project as a sub-project (depth strictly 1)')
  .action((title: string, opts: { note?: string; parent?: string }) => {
    run(() => addProjectCmd({ title, ...opts }))
  })

add
  .command('action <title>')
  .description('Create an action item')
  .option('--active', 'next action')
  .option('--deferred', 'someday/maybe')
  .option('--project <id>', 'parent project id')
  .option('--due <date>', 'due date (YYYY-MM-DD or natural language)')
  .option('--start <date>', 'start date — schedule action to auto-revive (implies --deferred if no mode flag)')
  .option('--note <text>', 'attach a note')
  .action(
    (title: string, opts: {
      active?: boolean
      deferred?: boolean
      project?: string
      due?: string
      start?: string
      note?: string
    }) => {
      run(() => addActionCmd({ title, ...opts }))
    },
  )

add
  .command('waiting <title>')
  .description('Create a waiting item')
  .option('--project <id>', 'parent project id')
  .option('--note <text>', 'attach a note')
  .action((title: string, opts: { project?: string; note?: string }) => {
    run(() => addWaitingCmd({ title, ...opts }))
  })

add
  .command('deadline <title>')
  .description('Create a deadline (date marker; not a task)')
  .requiredOption('--date <date>', 'deadline date (YYYY-MM-DD or natural language; must be future)')
  .option('--project <id>', 'parent project id')
  .option('--note <text>', 'attach a note')
  .action((title: string, opts: { date: string; project?: string; note?: string }) => {
    run(() => addDeadlineCmd({ title, ...opts }))
  })

add
  .command('memo <note>')
  .description('Create a memo')
  .option('--pinned', 'show on the daily dashboard')
  .option('--project <id>', 'parent project id')
  .action((note: string, opts: { pinned?: boolean; project?: string }) => {
    run(() => addMemoCmd({ note, ...opts }))
  })

program
  .command('edit <id>')
  .description('Edit any entity (project, action, waiting, deadline, or memo)')
  .option('--active', 'set status=active')
  .option('--deferred', 'set status=deferred')
  .option('--completed', 'set status=completed')
  .option('--dropped', 'set status=dropped')
  .option('--start <date>', "start date (action only); '' clears; with future date implies --deferred")
  .option('--title <text>', 'new title')
  .option('--note <text>', "note text; '' clears")
  .option('--pinned', 'pin memo (memos only)')
  .option('--no-pinned', 'unpin memo (memos only)')
  .option('--note-append <text>', 'append text to the existing note (joins with a blank line)')
  .option('--due <date>', "due date; '' clears (action only)")
  .option('--project <id>', "parent project id; '' detaches (item only)")
  .option('--parent <id>', "parent project; '' detaches to root (project only; depth strictly 1)")
  .option('--date <date>', 'deadline date (deadline only; must be future)')
  .action(
    (
      id: string,
      opts: {
        active?: boolean
        deferred?: boolean
        completed?: boolean
        dropped?: boolean
        pinned?: boolean
        start?: string
        title?: string
        note?: string
        noteAppend?: string
        due?: string
        project?: string
        parent?: string
        date?: string
      },
    ) => {
      run(() => editCmd(id, opts))
    },
  )

program
  .command('activate <id>')
  .description('status=active; clears closed_at')
  .action((id: string) => {
    run(() => activateCmd(id))
  })

program
  .command('defer <id>')
  .description('status=deferred; clears closed_at; --start schedules an action to revive on a future date')
  .option('--start <date>', 'future date — schedule the action to auto-revive (action only)')
  .action((id: string, opts: { start?: string }) => {
    run(() => deferCmd(id, opts))
  })

program
  .command('complete <id>')
  .description('status=completed; closed_at=now')
  .action((id: string) => {
    run(() => completeCmd(id))
  })

program
  .command('drop <id>')
  .description('status=dropped; closed_at=now')
  .action((id: string) => {
    run(() => dropCmd(id))
  })

program
  .command('config [key] [value]')
  .description(
    'Read or write CLI configuration. Bare `config` lists all keys. ' +
      '`config <key>` reads one key. `config <key> <value>` writes it. ' +
      'Known keys: data_dir.',
  )
  .action((key?: string, value?: string) => {
    run(() => configCmd(key, value))
  })

program.parse()
