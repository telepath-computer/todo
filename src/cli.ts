#!/usr/bin/env node
import { Command } from 'commander'
import {
  addActionCmd,
  addDeadlineCmd,
  addProjectCmd,
  addWaitingCmd,
} from './commands/add.js'
import { configCmd, setDataDirCmd } from './commands/config.js'
import { editCmd } from './commands/edit.js'
import {
  activateCmd,
  completeCmd,
  deferCmd,
  dropCmd,
} from './commands/lifecycle.js'
import { listCmd } from './commands/list.js'
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
  .description('GTD-style task and project CLI with JSON storage. Agent-first.')
  .helpOption('-h, --help', 'show help')

program
  .command('list')
  .description('Active actions, waiting items, and active projects')
  .option('--all', 'also include deferred actions and deferred projects')
  .action((opts: { all?: boolean }) => {
    run(() => listCmd({ all: opts.all }))
  })

program
  .command('show <id>')
  .description('Show a single entity (project, action, or waiting) by id')
  .action((id: string) => {
    run(() => showCmd(id))
  })

const add = program.command('add').description('Create a new entity')

add
  .command('project')
  .description('Create a project')
  .requiredOption('--title <text>', 'title')
  .option('--note <text>', 'attach a note')
  .action((opts: { title: string; note?: string }) => {
    run(() => addProjectCmd(opts))
  })

add
  .command('action')
  .description('Create an action item')
  .requiredOption('--title <text>', 'title')
  .option('--active', 'next action')
  .option('--deferred', 'someday/maybe')
  .option('--project <id>', 'parent project id')
  .option('--due <date>', 'due date (YYYY-MM-DD or natural language)')
  .option('--start <date>', 'start date — schedule action to auto-revive (implies --deferred if no mode flag)')
  .option('--note <text>', 'attach a note')
  .action(
    (opts: {
      title: string
      active?: boolean
      deferred?: boolean
      project?: string
      due?: string
      start?: string
      note?: string
    }) => {
      run(() => addActionCmd(opts))
    },
  )

add
  .command('waiting')
  .description('Create a waiting item')
  .requiredOption('--title <text>', 'title')
  .option('--project <id>', 'parent project id')
  .option('--note <text>', 'attach a note')
  .action((opts: { title: string; project?: string; note?: string }) => {
    run(() => addWaitingCmd(opts))
  })

add
  .command('deadline')
  .description('Create a deadline (date marker; not a task)')
  .requiredOption('--title <text>', 'title')
  .requiredOption('--date <date>', 'deadline date (YYYY-MM-DD or natural language; must be future)')
  .option('--project <id>', 'parent project id')
  .option('--note <text>', 'attach a note')
  .action((opts: { title: string; date: string; project?: string; note?: string }) => {
    run(() => addDeadlineCmd(opts))
  })

program
  .command('edit <id>')
  .description('Edit any entity (project, action, waiting, or deadline)')
  .option('--active', 'set status=active')
  .option('--deferred', 'set status=deferred')
  .option('--completed', 'set status=completed')
  .option('--dropped', 'set status=dropped')
  .option('--start <date>', "start date (action only); '' clears; with future date implies --deferred")
  .option('--title <text>', 'new title')
  .option('--note <text>', "note text; '' clears")
  .option('--due <date>', "due date; '' clears (action only)")
  .option('--project <id>', "parent project id; '' detaches (item only)")
  .option('--date <date>', 'deadline date (deadline only; must be future)')
  .action(
    (
      id: string,
      opts: {
        active?: boolean
        deferred?: boolean
        completed?: boolean
        dropped?: boolean
        start?: string
        title?: string
        note?: string
        due?: string
        project?: string
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
  .command('set-data-dir <path>')
  .description('Set the data directory (writes ~/.todo/config.json)')
  .action((path: string) => {
    run(() => setDataDirCmd(path))
  })

program
  .command('config')
  .description('Show resolved CLI configuration')
  .action(() => {
    run(() => configCmd())
  })

program.parse()
