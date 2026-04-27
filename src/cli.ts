#!/usr/bin/env node
import { Command } from 'commander'
import { addCmd } from './commands/add.js'
import { configCmd, setDataDirCmd } from './commands/config.js'
import { editCmd } from './commands/edit.js'
import {
  activateCmd,
  completeCmd,
  deferCmd,
  dropCmd,
} from './commands/lifecycle.js'
import { listCmd } from './commands/list.js'
import { addProjectCmd, editProjectCmd } from './commands/projects.js'
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
  .alias('ls')
  .description('List active actions, waiting items, and active projects')
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

program
  .command('add')
  .description('Add an action or waiting item')
  .requiredOption('--title <text>', 'title')
  .option('--active', 'create an active action (next action)')
  .option('--deferred', 'create a deferred action (someday/maybe)')
  .option('--waiting', 'create a waiting item')
  .option('--project <id>', 'parent project id')
  .option('--due <date>', 'due date (YYYY-MM-DD or natural language); action only')
  .option('--note <text>', 'attach a note')
  .action(
    (opts: {
      title: string
      active?: boolean
      deferred?: boolean
      waiting?: boolean
      project?: string
      due?: string
      note?: string
    }) => {
      run(() => addCmd(opts))
    },
  )

program
  .command('edit <id>')
  .description('Edit an item (title, note, due, project)')
  .option('--title <text>', 'new title')
  .option('--note <text>', "note text; '' clears")
  .option('--due <date>', "due date; '' clears (action only)")
  .option('--project <id>', "parent project id; '' detaches")
  .action(
    (
      id: string,
      opts: { title?: string; note?: string; due?: string; project?: string },
    ) => {
      run(() => editCmd(id, opts))
    },
  )

const projects = program.command('projects').description('Manage projects')

projects
  .command('add')
  .description('Create a new project')
  .requiredOption('--title <text>', 'project title')
  .option('--note <text>', 'attach a note')
  .action((opts: { title: string; note?: string }) => {
    run(() => addProjectCmd(opts))
  })

projects
  .command('edit <id>')
  .description('Edit a project (title, note)')
  .option('--title <text>', 'new title')
  .option('--note <text>', "note text; '' clears")
  .action((id: string, opts: { title?: string; note?: string }) => {
    run(() => editProjectCmd(id, opts))
  })

program
  .command('activate <id>')
  .description('Set active=true on an action or project; clears terminal state')
  .action((id: string) => {
    run(() => activateCmd(id))
  })

program
  .command('defer <id>')
  .description('Set active=false on an action or project; clears terminal state')
  .action((id: string) => {
    run(() => deferCmd(id))
  })

program
  .command('complete <id>')
  .description('Mark an entity completed')
  .action((id: string) => {
    run(() => completeCmd(id))
  })

program
  .command('drop <id>')
  .description('Mark an entity dropped')
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
