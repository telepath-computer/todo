import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { cleanup, makeTempDataDir, makeTempDir, parseJson, readJson, runCli } from './helpers.js'

type Status = 'active' | 'deferred' | 'completed' | 'dropped'

type Project = {
  id: string
  type: 'project'
  title: string
  note: string | null
  status: Status
  closed_at: string | null
  created_at: string
}

type Action = {
  id: string
  type: 'action'
  title: string
  project: string | null
  note: string | null
  created_at: string
  status: Status
  due: string | null
  start_at: string | null
  closed_at: string | null
}

type Waiting = {
  id: string
  type: 'waiting'
  title: string
  project: string | null
  note: string | null
  created_at: string
  status: 'active' | 'completed' | 'dropped'
  closed_at: string | null
}

type Item = Action | Waiting

type ListOutput = {
  active_actions: Action[]
  active_projects: Project[]
  waiting: Waiting[]
  deferred_actions?: Action[]
  deferred_projects?: Project[]
}

function ymd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function futureDate(daysAhead = 30): string {
  const d = new Date()
  d.setDate(d.getDate() + daysAhead)
  return ymd(d)
}

function pastDate(daysBack = 30): string {
  const d = new Date()
  d.setDate(d.getDate() - daysBack)
  return ymd(d)
}

function todayStr(): string {
  return ymd(new Date())
}

let dataDir: string

beforeEach(() => {
  dataDir = makeTempDataDir()
})

afterEach(() => {
  cleanup(dataDir)
})

function cli(...args: string[]) {
  return runCli(args, { dataDir })
}

function addProject(title: string, opts: { note?: string } = {}): Project {
  const args = ['add', 'project', '--title', title]
  if (opts.note !== undefined) args.push('--note', opts.note)
  const r = cli(...args)
  assert.equal(r.code, 0, r.stderr)
  return parseJson<Project>(r.stdout)
}

function addAction(
  title: string,
  flags: {
    active?: boolean
    deferred?: boolean
    project?: string
    due?: string
    start?: string
    note?: string
  } = {},
): Action {
  const args = ['add', 'action', '--title', title]
  if (flags.active) args.push('--active')
  if (flags.deferred) args.push('--deferred')
  if (flags.project) args.push('--project', flags.project)
  if (flags.due !== undefined) args.push('--due', flags.due)
  if (flags.start !== undefined) args.push('--start', flags.start)
  if (flags.note !== undefined) args.push('--note', flags.note)
  const r = cli(...args)
  assert.equal(r.code, 0, r.stderr)
  return parseJson<Action>(r.stdout)
}

function addWaitingItem(
  title: string,
  flags: { project?: string; note?: string } = {},
): Waiting {
  const args = ['add', 'waiting', '--title', title]
  if (flags.project) args.push('--project', flags.project)
  if (flags.note !== undefined) args.push('--note', flags.note)
  const r = cli(...args)
  assert.equal(r.code, 0, r.stderr)
  return parseJson<Waiting>(r.stdout)
}

// ---- Reads ----------------------------------------------------------

describe('todo list', () => {
  it('returns empty buckets on a fresh store', () => {
    const r = cli('list')
    assert.equal(r.code, 0)
    const out = parseJson<ListOutput>(r.stdout)
    assert.deepEqual(out, { active_actions: [], active_projects: [], waiting: [] })
  })

  it('includes active actions, waiting, and active projects only by default', () => {
    const proj = addProject('Telepath')
    const act = addAction('Find guests', { active: true, project: proj.id })
    addAction('Read DDIA', { deferred: true })
    addWaitingItem('Cover art', { project: proj.id })

    const out = parseJson<ListOutput>(cli('list').stdout)
    assert.equal(out.active_actions.length, 1)
    assert.equal(out.active_actions[0].id, act.id)
    assert.equal(out.active_projects.length, 1)
    assert.equal(out.active_projects[0].id, proj.id)
    assert.equal(out.waiting.length, 1)
    assert.equal(out.deferred_actions, undefined)
    assert.equal(out.deferred_projects, undefined)
  })

  it('--all surfaces deferred actions and deferred projects', () => {
    const proj = addProject('Side')
    cli('defer', proj.id)
    const def = addAction('Read DDIA', { deferred: true })

    const out = parseJson<ListOutput>(cli('list', '--all').stdout)
    assert.deepEqual(
      out.deferred_actions?.map((a) => a.id),
      [def.id],
    )
    assert.deepEqual(
      out.deferred_projects?.map((p) => p.id),
      [proj.id],
    )
    assert.deepEqual(out.active_projects, [])
  })

  it('hides actions whose parent project is deferred', () => {
    const proj = addProject('P')
    const child = addAction('child', { active: true, project: proj.id })
    cli('defer', proj.id)
    const out = parseJson<ListOutput>(cli('list').stdout)
    assert.equal(out.active_actions.find((a) => a.id === child.id), undefined)
  })

  it('excludes terminal items', () => {
    const a = addAction('done', { active: true })
    cli('complete', a.id)
    const out = parseJson<ListOutput>(cli('list').stdout)
    assert.deepEqual(out.active_actions, [])
  })

})

describe('todo show <id>', () => {
  it('returns the entity for any id (project, action, waiting)', () => {
    const p = addProject('P', { note: 'hi' })
    const a = addAction('A', { active: true, project: p.id })
    const w = addWaitingItem('W')

    assert.equal(parseJson<Project>(cli('show', p.id).stdout).id, p.id)
    assert.equal(parseJson<Action>(cli('show', a.id).stdout).id, a.id)
    assert.equal(parseJson<Waiting>(cli('show', w.id).stdout).id, w.id)
  })

  it('errors on unknown id with non-zero exit', () => {
    const r = cli('show', 'nopeNope')
    assert.equal(r.code, 1)
    assert.match(r.stderr, /not found: nopeNope/)
  })
})

// ---- Add ------------------------------------------------------------

describe('todo add', () => {
  it('creates an active action with project and due', () => {
    const proj = addProject('Tel')
    const a = addAction('Email Steve', {
      active: true,
      project: proj.id,
      due: '2026-05-03',
    })
    assert.equal(a.type, 'action')
    assert.equal(a.status, 'active')
    assert.equal(a.project, proj.id)
    assert.equal(a.due, '2026-05-03')
    assert.equal(a.closed_at, null)
    assert.match(a.id, /^[0-9a-zA-Z]{8}$/)
  })

  it('creates a deferred standalone action', () => {
    const a = addAction('Someday', { deferred: true })
    assert.equal(a.status, 'deferred')
    assert.equal(a.project, null)
  })

  it('creates a waiting item without --due support', () => {
    const w = addWaitingItem('Tax docs', { note: 'sent 2026-04-15' })
    assert.equal(w.type, 'waiting')
    assert.equal(w.status, 'active')
    assert.equal(w.note, 'sent 2026-04-15')
    assert.equal(w.project, null)
  })

  it('errors when neither --active nor --deferred is given on action', () => {
    const r = cli('add', 'action', '--title', 'X')
    assert.equal(r.code, 1)
    assert.match(r.stderr, /--active, --deferred, or --start is required/i)
  })

  it('errors when both --active and --deferred are given', () => {
    const r = cli('add', 'action', '--title', 'X', '--active', '--deferred')
    assert.equal(r.code, 1)
    assert.match(r.stderr, /mutually exclusive/i)
  })

  it('errors on unknown --project', () => {
    const r = cli('add', 'action', '--title', 'X', '--active', '--project', 'noSuchPr')
    assert.equal(r.code, 1)
    assert.match(r.stderr, /unknown project/i)
  })

  it('persists store as JSON on disk with sorted keys', () => {
    addAction('one', { active: true })
    const path = join(dataDir, 'store.json')
    assert.ok(existsSync(path))
    const store = readJson<{ items: Action[] }>(path)
    assert.equal(store.items.length, 1)
  })

  it('resolves natural-language --due via chrono', () => {
    const a = addAction('Tomorrow task', { active: true, due: 'tomorrow' })
    assert.match(a.due ?? '', /^\d{4}-\d{2}-\d{2}$/)
  })

  it('rejects unparseable --due', () => {
    const r = cli('add', 'action', '--title', 'X', '--active', '--due', 'asdfghjkl')
    assert.equal(r.code, 1)
    assert.match(r.stderr, /could not parse date/i)
  })
})

// ---- Edit -----------------------------------------------------------

describe('todo edit <id>', () => {
  it('updates fields and clears with empty string', () => {
    const a = addAction('Old', { active: true, due: '2026-05-01' })
    const r = cli('edit', a.id, '--title', 'New', '--due', '')
    assert.equal(r.code, 0)
    const out = parseJson<Action>(r.stdout)
    assert.equal(out.title, 'New')
    assert.equal(out.due, null)
  })

  it('detaches from project with --project ""', () => {
    const proj = addProject('P')
    const a = addAction('x', { active: true, project: proj.id })
    const out = parseJson<Action>(cli('edit', a.id, '--project', '').stdout)
    assert.equal(out.project, null)
  })

  it('errors on --due against waiting', () => {
    const w = addWaitingItem('Wait')
    const r = cli('edit', w.id, '--due', '2026-05-01')
    assert.equal(r.code, 1)
    assert.match(r.stderr, /--due.*not allowed.*waiting/i)
  })

  it('errors when no patch fields provided', () => {
    const a = addAction('x', { active: true })
    const r = cli('edit', a.id)
    assert.equal(r.code, 1)
    assert.match(r.stderr, /nothing to edit/i)
  })

  it('errors on unknown id', () => {
    const r = cli('edit', 'nope1234', '--title', 'x')
    assert.equal(r.code, 1)
    assert.match(r.stderr, /not found/i)
  })
})

// ---- Projects add/edit ----------------------------------------------

describe('todo projects add/edit', () => {
  it('adds a project with note', () => {
    const p = addProject('Telepath', { note: 'big idea' })
    assert.equal(p.type, 'project')
    assert.equal(p.note, 'big idea')
    assert.equal(p.status, 'active')
    assert.equal(p.closed_at, null)
  })

  it('edits a project via polymorphic edit, clearing note with ""', () => {
    const p = addProject('X', { note: 'a' })
    const r = cli('edit', p.id, '--note', '')
    assert.equal(r.code, 0)
    const out = parseJson<Project>(r.stdout)
    assert.equal(out.note, null)
  })

  it('rejects --due / --project on a project edit', () => {
    const p = addProject('P')
    let r = cli('edit', p.id, '--due', '2026-05-01')
    assert.equal(r.code, 1)
    assert.match(r.stderr, /--due.*not allowed.*project/i)
    r = cli('edit', p.id, '--project', 'x')
    assert.equal(r.code, 1)
    assert.match(r.stderr, /--project.*not allowed.*project/i)
  })

  it('rejects empty title on add project', () => {
    const r = cli('add', 'project', '--title', '   ')
    assert.equal(r.code, 1)
    assert.match(r.stderr, /title is required/i)
  })
})

// ---- Lifecycle -------------------------------------------------------

describe('lifecycle (activate/defer/complete/drop)', () => {
  it('activate sets status=active and clears closed', () => {
    const p = addProject('P')
    cli('complete', p.id)
    const out = parseJson<Project>(cli('activate', p.id).stdout)
    assert.equal(out.status, 'active')
    assert.equal(out.closed_at, null)
  })

  it('defer sets status=deferred and clears closed', () => {
    const a = addAction('x', { active: true })
    cli('drop', a.id)
    const out = parseJson<Action>(cli('defer', a.id).stdout)
    assert.equal(out.status, 'deferred')
    assert.equal(out.closed_at, null)
  })

  it('activate/defer both reject waiting items', () => {
    const w = addWaitingItem('w')
    let r = cli('activate', w.id)
    assert.equal(r.code, 1)
    assert.match(r.stderr, /waiting/i)
    r = cli('defer', w.id)
    assert.equal(r.code, 1)
    assert.match(r.stderr, /waiting/i)
  })

  it('complete and drop are mutually exclusive (last write wins on closed timestamp)', () => {
    const a = addAction('x', { active: true })
    let out: Item = parseJson<Action>(cli('complete', a.id).stdout)
    assert.equal(out.status, 'completed')
    assert.notEqual(out.closed_at, null)
    out = parseJson<Action>(cli('drop', a.id).stdout)
    assert.equal(out.status, 'dropped')
    assert.notEqual(out.closed_at, null)
  })

  it('complete/drop accept waiting items', () => {
    const w = addWaitingItem('w')
    const out = parseJson<Waiting>(cli('complete', w.id).stdout)
    assert.equal(out.status, 'completed')
    assert.notEqual(out.closed_at, null)
  })
})

// ---- Config ----------------------------------------------------------

describe('config / set-data-dir', () => {
  it('config reports default source when nothing set', () => {
    const home = makeTempDir('todo-home-')
    try {
      const r = runCli(['config'], { home, env: { TODO_DATA_DIR: undefined } })
      assert.equal(r.code, 0)
      const out = parseJson<{ source: string; dataDir: string }>(r.stdout)
      assert.equal(out.source, 'default')
    } finally {
      cleanup(home)
    }
  })

  it('config reports env source when TODO_DATA_DIR is set', () => {
    const r = cli('config')
    const out = parseJson<{ source: string; dataDir: string }>(r.stdout)
    assert.equal(out.source, 'env')
    assert.equal(out.dataDir, dataDir)
  })

  it('set-data-dir writes config and returns config-source', () => {
    const home = makeTempDir('todo-home-')
    const target = makeTempDataDir()
    try {
      const r = runCli(['set-data-dir', target], { home, env: { TODO_DATA_DIR: undefined } })
      assert.equal(r.code, 0)
      const out = parseJson<{ source: string; dataDir: string }>(r.stdout)
      assert.equal(out.source, 'config')
      assert.equal(out.dataDir, target)
      // Re-run config from the same sandbox HOME (without env)
      const r2 = runCli(['config'], { home, env: { TODO_DATA_DIR: undefined } })
      const out2 = parseJson<{ source: string }>(r2.stdout)
      assert.equal(out2.source, 'config')
    } finally {
      cleanup(home)
      cleanup(target)
    }
  })

  it('rejects relative paths in set-data-dir', () => {
    const home = makeTempDir('todo-home-')
    try {
      const r = runCli(['set-data-dir', 'relative/path'], { home, env: { TODO_DATA_DIR: undefined } })
      assert.equal(r.code, 1)
      assert.match(r.stderr, /absolute path/i)
    } finally {
      cleanup(home)
    }
  })

  it('rejects relative TODO_DATA_DIR with a clean error', () => {
    const home = makeTempDir('todo-home-')
    try {
      const r = runCli(['list'], { home, env: { TODO_DATA_DIR: 'rel/data' } })
      assert.equal(r.code, 1)
      assert.match(r.stderr, /absolute path/i)
    } finally {
      cleanup(home)
    }
  })
})

describe('first run', () => {
  it('list returns empty buckets without ever needing the data dir on disk', () => {
    const home = makeTempDir('todo-home-')
    const dir = join(makeTempDir('todo-data-parent-'), 'never-existed')
    try {
      const r = runCli(['list'], { home, env: { TODO_DATA_DIR: dir } })
      assert.equal(r.code, 0, r.stderr)
      const out = parseJson<{ active_actions: unknown[] }>(r.stdout)
      assert.deepEqual(out, { active_actions: [], active_projects: [], waiting: [] })
      // Reading shouldn't have created the dir.
      assert.equal(existsSync(dir), false)
    } finally {
      cleanup(home)
    }
  })
})

describe('malformed store.json', () => {
  it('surfaces a clean DoError, not a stack trace', () => {
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(join(dataDir, 'store.json'), '{ this is not json')
    const r = cli('list')
    assert.equal(r.code, 1)
    assert.match(r.stderr, /malformed store\.json/i)
    // No stack trace line (e.g. "    at ")
    assert.doesNotMatch(r.stderr, /^\s+at /m)
  })
})

// ---- Help / no-op ----------------------------------------------------

describe('help', () => {
  it('exits 0 and prints help with no args', () => {
    const r = cli()
    assert.equal(r.code, 1)
    // commander prints help to stderr on no args by default
    const out = (r.stdout + r.stderr).toLowerCase()
    assert.match(out, /usage: todo/)
  })
})

// ---- Start dates ----------------------------------------------------

describe('start dates', () => {
  describe('add action --start', () => {
    it('happy path: --deferred --start <future>', () => {
      const a = addAction('Read DDIA', { deferred: true, start: futureDate(7) })
      assert.equal(a.status, 'deferred')
      assert.equal(a.start_at, futureDate(7))
    })

    it('rejects --active --start', () => {
      const r = cli('add', 'action', '--title', 'X', '--active', '--start', futureDate(7))
      assert.equal(r.code, 1)
      assert.match(r.stderr, /--start cannot combine with --active/i)
    })

    it('--start alone implies --deferred', () => {
      const a = addAction('Implicit', { start: futureDate(7) })
      assert.equal(a.status, 'deferred')
      assert.equal(a.start_at, futureDate(7))
    })

    it('rejects no flags at all', () => {
      const r = cli('add', 'action', '--title', 'X')
      assert.equal(r.code, 1)
      assert.match(r.stderr, /--active, --deferred, or --start is required/i)
    })

    it('rejects --deferred --start today', () => {
      const r = cli('add', 'action', '--title', 'X', '--deferred', '--start', todayStr())
      assert.equal(r.code, 1)
      assert.match(r.stderr, /start date must be in the future/i)
    })

    it('rejects --deferred --start <past>', () => {
      const r = cli('add', 'action', '--title', 'X', '--deferred', '--start', pastDate(1))
      assert.equal(r.code, 1)
      assert.match(r.stderr, /start date must be in the future/i)
    })

    it('rejects --deferred --start ""', () => {
      const r = cli('add', 'action', '--title', 'X', '--deferred', '--start', '')
      assert.equal(r.code, 1)
      assert.match(r.stderr, /--start cannot be empty/i)
    })

    it('parses natural-language --start (tomorrow)', () => {
      const a = addAction('NL', { deferred: true, start: 'tomorrow' })
      assert.equal(a.status, 'deferred')
      assert.match(a.start_at ?? '', /^\d{4}-\d{2}-\d{2}$/)
    })
  })

  describe('defer <id> --start', () => {
    it('schedules an action via defer --start <future>', () => {
      const a = addAction('x', { active: true })
      const out = parseJson<Action>(cli('defer', a.id, '--start', futureDate(14)).stdout)
      assert.equal(out.status, 'deferred')
      assert.equal(out.start_at, futureDate(14))
      assert.equal(out.closed_at, null)
    })

    it('defer --start <future> matches edit --deferred --start <future>', () => {
      const a1 = addAction('one', { active: true })
      const a2 = addAction('two', { active: true })
      const future = futureDate(7)
      const v1 = parseJson<Action>(cli('defer', a1.id, '--start', future).stdout)
      const v2 = parseJson<Action>(cli('edit', a2.id, '--deferred', '--start', future).stdout)
      assert.equal(v1.status, v2.status)
      assert.equal(v1.start_at, v2.start_at)
      assert.equal(v1.closed_at, v2.closed_at)
    })

    it('defer (no --start) clears any prior start_at', () => {
      const a = addAction('x', { deferred: true, start: futureDate(7) })
      assert.equal(a.start_at, futureDate(7))
      const out = parseJson<Action>(cli('defer', a.id).stdout)
      assert.equal(out.status, 'deferred')
      assert.equal(out.start_at, null)
    })

    it('rejects --start on a project (entity-type rule first)', () => {
      const p = addProject('P')
      const r = cli('defer', p.id, '--start', pastDate(7))
      assert.equal(r.code, 1)
      assert.match(r.stderr, /--start is not allowed on projects/i)
    })

    it('rejects --start on waiting items', () => {
      const w = addWaitingItem('w')
      const r = cli('defer', w.id, '--start', futureDate(7))
      assert.equal(r.code, 1)
      assert.match(r.stderr, /--start is not allowed on waiting items/i)
    })

    it('rejects --start ""', () => {
      const a = addAction('x', { deferred: true })
      const r = cli('defer', a.id, '--start', '')
      assert.equal(r.code, 1)
      assert.match(r.stderr, /--start cannot be empty/i)
    })

    it('rejects --start <past>', () => {
      const a = addAction('x', { active: true })
      const r = cli('defer', a.id, '--start', pastDate(1))
      assert.equal(r.code, 1)
      assert.match(r.stderr, /start date must be in the future/i)
    })
  })

  describe('edit <id> --start', () => {
    it('--start <future> on active action flips status to deferred', () => {
      const a = addAction('x', { active: true })
      const out = parseJson<Action>(cli('edit', a.id, '--start', futureDate(7)).stdout)
      assert.equal(out.status, 'deferred')
      assert.equal(out.start_at, futureDate(7))
    })

    it('--start <future> on terminal action revives it (closed_at cleared)', () => {
      const a = addAction('x', { active: true })
      cli('complete', a.id)
      const out = parseJson<Action>(cli('edit', a.id, '--start', futureDate(7)).stdout)
      assert.equal(out.status, 'deferred')
      assert.equal(out.start_at, futureDate(7))
      assert.equal(out.closed_at, null)
    })

    it('--start "" clears start_at, leaves status alone', () => {
      const a = addAction('x', { deferred: true, start: futureDate(7) })
      const out = parseJson<Action>(cli('edit', a.id, '--start', '').stdout)
      assert.equal(out.status, 'deferred')
      assert.equal(out.start_at, null)
    })

    it('--active --start <date> rejected', () => {
      const a = addAction('x', { active: true })
      const r = cli('edit', a.id, '--active', '--start', futureDate(7))
      assert.equal(r.code, 1)
      assert.match(r.stderr, /--start requires --deferred/i)
    })

    it('--completed --start <date> rejected', () => {
      const a = addAction('x', { active: true })
      const r = cli('edit', a.id, '--completed', '--start', futureDate(7))
      assert.equal(r.code, 1)
      assert.match(r.stderr, /--start is not allowed with --completed \/ --dropped/i)
    })

    it('--dropped --start <date> rejected', () => {
      const a = addAction('x', { active: true })
      const r = cli('edit', a.id, '--dropped', '--start', futureDate(7))
      assert.equal(r.code, 1)
      assert.match(r.stderr, /--start is not allowed with --completed \/ --dropped/i)
    })

    it('--start on project rejected (entity rule first)', () => {
      const p = addProject('P')
      const r = cli('edit', p.id, '--start', futureDate(7))
      assert.equal(r.code, 1)
      assert.match(r.stderr, /--start is not allowed on projects/i)
    })

    it('--start on waiting item rejected', () => {
      const w = addWaitingItem('w')
      const r = cli('edit', w.id, '--start', futureDate(7))
      assert.equal(r.code, 1)
      assert.match(r.stderr, /--start is not allowed on waiting items/i)
    })

    it('two status flags rejected', () => {
      const a = addAction('x', { active: true })
      const r = cli('edit', a.id, '--active', '--deferred')
      assert.equal(r.code, 1)
      assert.match(r.stderr, /mutually exclusive/i)
    })

    it('--active activates a deferred action and clears start_at', () => {
      const a = addAction('x', { deferred: true, start: futureDate(7) })
      const out = parseJson<Action>(cli('edit', a.id, '--active').stdout)
      assert.equal(out.status, 'active')
      assert.equal(out.start_at, null)
      assert.equal(out.closed_at, null)
    })

    it('--completed sets closed_at and clears start_at', () => {
      const a = addAction('x', { deferred: true, start: futureDate(7) })
      const out = parseJson<Action>(cli('edit', a.id, '--completed').stdout)
      assert.equal(out.status, 'completed')
      assert.equal(out.start_at, null)
      assert.notEqual(out.closed_at, null)
    })

    it('combines field edits with status flag in a single call', () => {
      const a = addAction('x', { active: true, due: '2026-05-01' })
      const out = parseJson<Action>(
        cli('edit', a.id, '--deferred', '--start', futureDate(14), '--title', 'Renamed').stdout,
      )
      assert.equal(out.title, 'Renamed')
      assert.equal(out.status, 'deferred')
      assert.equal(out.start_at, futureDate(14))
      assert.equal(out.due, '2026-05-01')
    })
  })

  describe('list with start dates', () => {
    it('--all surfaces scheduled actions in deferred_actions', () => {
      const a = addAction('Read DDIA', { deferred: true, start: futureDate(30) })
      const out = parseJson<ListOutput>(cli('list', '--all').stdout)
      assert.deepEqual(out.deferred_actions?.map((x) => x.id), [a.id])
    })

    it('open-ended deferred and scheduled both land in deferred_actions', () => {
      const a1 = addAction('Someday', { deferred: true })
      const a2 = addAction('Renew', { deferred: true, start: futureDate(30) })
      const out = parseJson<ListOutput>(cli('list', '--all').stdout)
      assert.deepEqual(
        (out.deferred_actions ?? []).map((x) => x.id).sort(),
        [a1.id, a2.id].sort(),
      )
    })

    it('past-due scheduled item appears in active_actions, not deferred_actions', () => {
      const proj = addProject('P')
      const a = addAction('past', { deferred: true, project: proj.id, start: futureDate(7) })
      // Hand-edit start_at to a past date directly in the store
      const path = join(dataDir, 'store.json')
      const raw = readJson<{ items: Action[]; lists: Project[] }>(path)
      const idx = raw.items.findIndex((i) => i.id === a.id)
      raw.items[idx].start_at = pastDate(1)
      writeFileSync(path, JSON.stringify(raw))

      const out = parseJson<ListOutput>(cli('list', '--all').stdout)
      assert.deepEqual(out.active_actions.map((x) => x.id), [a.id])
      assert.deepEqual(out.deferred_actions, [])
    })

    it('parent project deferred hides scheduled child from both buckets', () => {
      const proj = addProject('P')
      addAction('child', { deferred: true, project: proj.id, start: futureDate(14) })
      cli('defer', proj.id)
      const out = parseJson<ListOutput>(cli('list', '--all').stdout)
      assert.deepEqual(out.active_actions, [])
      assert.deepEqual(out.deferred_actions, [])
    })
  })

  describe('schema compatibility', () => {
    it('reads a v0.3-shaped action (no start_at) cleanly via list', () => {
      mkdirSync(dataDir, { recursive: true })
      const v03 = {
        lists: [],
        items: [
          {
            id: 'aabbccdd',
            type: 'action',
            title: 'Old action',
            project: null,
            note: null,
            created_at: '2026-04-01T00:00:00Z',
            status: 'active',
            due: null,
            closed_at: null,
          },
        ],
      }
      writeFileSync(join(dataDir, 'store.json'), JSON.stringify(v03))
      const out = parseJson<ListOutput>(cli('list').stdout)
      assert.equal(out.active_actions.length, 1)
      assert.equal(out.active_actions[0].start_at, null)
    })
  })
})
