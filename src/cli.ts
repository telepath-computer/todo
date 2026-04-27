#!/usr/bin/env node
import { Command } from 'commander'
import { DoError } from './core/errors.js'
import { renderError } from './views/atoms.js'
import {
  addProjectCmd,
  editProjectCmd,
  listProjectsCmd,
  removeProjectCmd,
  showProjectCmd,
} from './commands/projects.js'
import {
  addTaskCmd,
  completeTaskCmd,
  editTaskCmd,
  listTasksCmd,
  removeTaskCmd,
  showTaskCmd,
  uncompleteTaskCmd,
} from './commands/tasks.js'
import { setVaultCmd } from './commands/config.js'
import { listCmd } from './commands/list.js'

function getVaultFlag(cmd: Command): string | undefined {
  return cmd.optsWithGlobals().vault
}

function run(fn: () => string): void {
  try {
    const out = fn()
    if (out) {
      if (process.stdout.isTTY) console.log()
      console.log(out)
      if (process.stdout.isTTY) console.log()
    }
  } catch (err) {
    if (err instanceof DoError) {
      if (process.stderr.isTTY) console.error()
      console.error(renderError(err.message))
      if (process.stderr.isTTY) console.error()
      process.exit(1)
    }
    throw err
  }
}

const program = new Command('todo')
program
  .description('CLI for GTD-style projects and actions over structured markdown files')
  .option('--vault <path>', 'override configured vault directory')

const projects = program.command('projects').description('Manage projects')

projects
  .command('list')
  .description('List all projects')
  .action((_opts, cmd: Command) => {
    run(() => listProjectsCmd(getVaultFlag(cmd)))
  })

projects
  .command('add <slug>')
  .description('Create a new project')
  .option('--title <text>', 'frontmatter title (defaults to slug)')
  .option('--notes <text>', 'project-level notes (multi-line allowed)')
  .action(
    (slug: string, opts: { title?: string; notes?: string }, cmd: Command) => {
      run(() => addProjectCmd(getVaultFlag(cmd), slug, opts.title, opts.notes))
    },
  )

projects
  .command('show <slug>')
  .description('Show project details, notes, and tasks')
  .action((slug: string, _opts, cmd: Command) => {
    run(() => showProjectCmd(getVaultFlag(cmd), slug))
  })

projects
  .command('edit <slug>')
  .description('Edit a project (title and/or notes)')
  .option('--title <text>', 'new frontmatter title')
  .option('--notes <text>', "project-level notes; pass '' to clear")
  .action(
    (slug: string, opts: { title?: string; notes?: string }, cmd: Command) => {
      run(() =>
        editProjectCmd(getVaultFlag(cmd), slug, {
          title: opts.title,
          notes: opts.notes,
        }),
      )
    },
  )

projects
  .command('remove <slug>')
  .description('Delete a project')
  .action((slug: string, _opts, cmd: Command) => {
    run(() => removeProjectCmd(getVaultFlag(cmd), slug))
  })

const tasks = program.command('tasks').description('Manage tasks')

tasks
  .command('list')
  .description('List tasks across all projects, or within one')
  .option('--project <slug>', 'filter by project')
  .option('--available', 'show only Available items')
  .option('--waiting', 'show only Waiting items')
  .option('--deferred', 'show only Deferred items')
  .option('--all', 'show all three lanes (Available + Waiting + Deferred)')
  .action(
    (
      opts: {
        project?: string
        available?: boolean
        waiting?: boolean
        deferred?: boolean
        all?: boolean
      },
      cmd: Command,
    ) => {
      run(() =>
        listTasksCmd(getVaultFlag(cmd), opts.project, {
          available: opts.available,
          waiting: opts.waiting,
          deferred: opts.deferred,
          all: opts.all,
        }),
      )
    },
  )

tasks
  .command('add')
  .description('Append a task to a project')
  .requiredOption('--title <text>', 'task text')
  .requiredOption('--project <slug>', 'project slug to add to')
  .option('--due <date>', 'due date (YYYY-MM-DD or natural language)')
  .option('--notes <text>', 'attach task-level notes (multi-line allowed)')
  .option('--available', 'add to Available lane (default)')
  .option('--waiting', 'add to Waiting lane')
  .option('--deferred', 'add to Deferred lane')
  .option(
    '--context <name>',
    'attach a context tag (repeatable, e.g. --context errand --context home)',
    (value: string, prev: string[] = []) => prev.concat([value]),
  )
  .action(
    (
      opts: {
        title: string
        project: string
        due?: string
        notes?: string
        available?: boolean
        waiting?: boolean
        deferred?: boolean
        context?: string[]
      },
      cmd: Command,
    ) => {
      run(() =>
        addTaskCmd(
          getVaultFlag(cmd),
          opts.title,
          opts.project,
          opts.due,
          opts.notes,
          {
            available: opts.available,
            waiting: opts.waiting,
            deferred: opts.deferred,
          },
          opts.context ?? [],
        ),
      )
    },
  )

tasks
  .command('show <ref>')
  .description('Show a task with its notes (if any)')
  .action((ref: string, _opts, cmd: Command) => {
    run(() => showTaskCmd(getVaultFlag(cmd), ref))
  })

tasks
  .command('complete <ref>')
  .description('Mark a task complete')
  .action((ref: string, _opts, cmd: Command) => {
    run(() => completeTaskCmd(getVaultFlag(cmd), ref))
  })

tasks
  .command('uncomplete <ref>')
  .description('Mark a task not complete')
  .action((ref: string, _opts, cmd: Command) => {
    run(() => uncompleteTaskCmd(getVaultFlag(cmd), ref))
  })

tasks
  .command('edit <ref>')
  .description('Edit a task (title, due, notes, lane, contexts, or move to another project)')
  .option('--title <text>', 'new task text')
  .option('--due <date>', "due date (YYYY-MM-DD or natural language); pass '' to clear")
  .option('--project <slug>', 'move to another project')
  .option('--notes <text>', "task-level notes (multi-line allowed); pass '' to clear")
  .option('--available', 'move to Available lane')
  .option('--waiting', 'move to Waiting lane')
  .option('--deferred', 'move to Deferred lane')
  .option(
    '--context <name>',
    "replace contexts (repeatable; pass '' once to clear)",
    (value: string, prev: string[] = []) => prev.concat([value]),
  )
  .action(
    (
      ref: string,
      opts: {
        title?: string
        due?: string
        project?: string
        notes?: string
        available?: boolean
        waiting?: boolean
        deferred?: boolean
        context?: string[]
      },
      cmd: Command,
    ) => {
      run(() =>
        editTaskCmd(
          getVaultFlag(cmd),
          ref,
          {
            title: opts.title,
            due: opts.due,
            project: opts.project,
            notes: opts.notes,
          },
          {
            available: opts.available,
            waiting: opts.waiting,
            deferred: opts.deferred,
          },
          opts.context,
        ),
      )
    },
  )

tasks
  .command('remove <ref>')
  .description('Delete a task')
  .action((ref: string, _opts, cmd: Command) => {
    run(() => removeTaskCmd(getVaultFlag(cmd), ref))
  })

program
  .command('list')
  .description('Cross-project dashboard: Tasks, Waiting, Projects (and Deferred with --all)')
  .option('--all', 'include the Deferred section')
  .action((opts: { all?: boolean }, cmd: Command) => {
    run(() => listCmd(getVaultFlag(cmd), { all: opts.all }))
  })

program
  .command('set-vault <path>')
  .description('Set the default vault (writes ~/.todo/config.json)')
  .action((path: string) => {
    run(() => setVaultCmd(path))
  })

program.parse()
