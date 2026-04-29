import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { cleanup, makeTempDataDir, makeTempDir, parseJson, readJson, runCli } from './helpers.js'

function ymd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const FUTURE = ymd(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))
const PAST = ymd(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))

type Status = 'active' | 'deferred' | 'completed' | 'dropped'

type Project = {
  id: string
  type: 'project'
  title: string
  note: string | null
  status: Status
  closed_at: string | null
  created_at: string
  parent: string | null
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

type Deadline = {
  id: string
  type: 'deadline'
  title: string
  project: string | null
  note: string | null
  created_at: string
  status: 'active' | 'dropped'
  date: string
  closed_at: string | null
}

type Item = Action | Waiting | Deadline

type ListOutput = {
  active_actions: Action[]
  active_projects: Project[]
  deadlines: Deadline[]
  waiting: Waiting[]
  deferred_actions?: Action[]
  deferred_projects?: Project[]
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

function addProject(title: string, opts: { note?: string; parent?: string } = {}): Project {
  const args = ['add', 'project', '--title', title]
  if (opts.note !== undefined) args.push('--note', opts.note)
  if (opts.parent !== undefined) args.push('--parent', opts.parent)
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

function addDeadlineItem(
  title: string,
  flags: { date: string; project?: string; note?: string },
): Deadline {
  const args = ['add', 'deadline', '--title', title, '--date', flags.date]
  if (flags.project) args.push('--project', flags.project)
  if (flags.note !== undefined) args.push('--note', flags.note)
  const r = cli(...args)
  assert.equal(r.code, 0, r.stderr)
  return parseJson<Deadline>(r.stdout)
}

// ---- Reads ----------------------------------------------------------

describe('todo (bare dashboard)', () => {
  it('returns empty output on a fresh store', () => {
    const r = cli()
    assert.equal(r.code, 0, r.stderr)
    assert.equal(r.stdout, '')
  })

  it('includes active actions, waiting, deadlines, active projects as YAML-like blocks', () => {
    const proj = addProject('Telepath')
    const act = addAction('Find guests', { active: true, project: proj.id })
    addAction('Read DDIA', { deferred: true })
    addWaitingItem('Cover art', { project: proj.id })

    const r = cli()
    assert.equal(r.code, 0, r.stderr)
    assert.match(r.stdout, /^ACTIVE ACTIONS \[1\]:$/m)
    assert.ok(r.stdout.includes(`- id: ${act.id}`))
    assert.ok(r.stdout.includes('  title: "Find guests"'))
    assert.match(r.stdout, /^WAITING \[1\]:$/m)
    assert.ok(r.stdout.includes('  title: "Cover art"'))
    assert.match(r.stdout, /^ACTIVE PROJECTS \[1\]:$/m)
    assert.ok(r.stdout.includes(`- id: ${proj.id}`))
    assert.ok(r.stdout.includes('  title: "Telepath"'))
    // Deferred bucket isn't surfaced on the dashboard.
    assert.doesNotMatch(r.stdout, /^DEFERRED/m)
    // Status hidden in dashboard buckets.
    assert.doesNotMatch(r.stdout, /^\s*status:/m)
  })

  it('hides actions whose parent project is deferred', () => {
    const proj = addProject('P')
    const child = addAction('child', { active: true, project: proj.id })
    cli('defer', proj.id)
    const r = cli()
    assert.ok(!r.stdout.includes(`id: ${child.id}`))
  })

  it('excludes terminal items', () => {
    const a = addAction('done', { active: true })
    cli('complete', a.id)
    const r = cli()
    assert.doesNotMatch(r.stdout, /ACTIVE ACTIONS/)
  })
})

describe('todo list <type>', () => {
  it('lists all actions regardless of status with status field', () => {
    const a1 = addAction('a1', { active: true })
    const a2 = addAction('a2', { deferred: true })
    const r = cli('list', 'actions')
    assert.equal(r.code, 0, r.stderr)
    assert.match(r.stdout, /^ACTIONS \[2\]:$/m)
    assert.ok(r.stdout.includes(`- id: ${a1.id}`))
    assert.ok(r.stdout.includes('  status: active'))
    assert.ok(r.stdout.includes(`- id: ${a2.id}`))
    assert.ok(r.stdout.includes('  status: deferred'))
  })

  it('lists all projects regardless of status', () => {
    const p = addProject('P')
    cli('drop', p.id)
    const r = cli('list', 'projects')
    assert.match(r.stdout, /^PROJECTS \[1\]:$/m)
    assert.ok(r.stdout.includes('  status: dropped'))
  })

  it('lists deadlines and waiting items', () => {
    const proj = addProject('P')
    const d = addDeadlineItem('Q3', { date: FUTURE, project: proj.id })
    const w = addWaitingItem('Cover', { project: proj.id })
    const rd = cli('list', 'deadlines')
    assert.match(rd.stdout, /^DEADLINES \[1\]:$/m)
    assert.ok(rd.stdout.includes(`id: ${d.id}`))
    const rw = cli('list', 'waiting')
    assert.match(rw.stdout, /^WAITING \[1\]:$/m)
    assert.ok(rw.stdout.includes(`id: ${w.id}`))
  })

  it('rejects unknown type', () => {
    const r = cli('list', 'nonsense')
    assert.equal(r.code, 1)
    assert.match(r.stderr, /unknown type/i)
  })

  it('returns just the heading when nothing matches', () => {
    const r = cli('list', 'actions')
    assert.equal(r.code, 0)
    assert.equal(r.stdout.trim(), 'ACTIONS [0]:')
  })
})

describe('todo show <id>', () => {
  it('renders projects with a header and flush-left key fields', () => {
    const p = addProject('P', { note: 'hi' })
    const r = cli('show', p.id)
    assert.equal(r.code, 0)
    assert.match(r.stdout, new RegExp(`^PROJECT: "P" \\[${p.id}\\]$`, 'm'))
    assert.match(r.stdout, /^status: active$/m)
    assert.match(r.stdout, /^note: "hi"$/m)
    // Body is flush-left, not indented.
    assert.doesNotMatch(r.stdout, /^  status:/m)
  })

  it('does not show a HINTS section on a project view', () => {
    const p = addProject('P')
    addAction('someday', { deferred: true })
    const r = cli('show', p.id)
    assert.equal(r.code, 0)
    assert.ok(!r.stdout.includes('HINTS:'))
  })

  it('renders an action with header and key fields', () => {
    const a = addAction('A', { active: true })
    const r = cli('show', a.id)
    assert.equal(r.code, 0)
    assert.match(r.stdout, new RegExp(`^ACTION: "A" \\[${a.id}\\]$`, 'm'))
    assert.match(r.stdout, /^status: active$/m)
  })

  it('renders a waiting item with age', () => {
    const w = addWaitingItem('W')
    const r = cli('show', w.id)
    assert.match(r.stdout, new RegExp(`^WAITING: "W" \\[${w.id}\\]$`, 'm'))
    assert.match(r.stdout, /^age: \d+ days?$/m)
  })

  it('embeds project sub-buckets (active/deferred actions, waiting, deadlines)', () => {
    const p = addProject('P')
    const otherProj = addProject('Other')
    const act = addAction('a', { active: true, project: p.id })
    const def = addAction('d', { deferred: true, project: p.id })
    const w = addWaitingItem('w', { project: p.id })
    const d = addDeadlineItem('dl', { date: FUTURE, project: p.id })
    addAction('elsewhere', { active: true, project: otherProj.id })

    const r = cli('show', p.id)
    assert.equal(r.code, 0)
    assert.match(r.stdout, /^ACTIVE ACTIONS \[1\]:$/m)
    assert.ok(r.stdout.includes(`id: ${act.id}`))
    assert.match(r.stdout, /^DEFERRED ACTIONS \[1\]:$/m)
    assert.ok(r.stdout.includes(`id: ${def.id}`))
    assert.match(r.stdout, /^WAITING \[1\]:$/m)
    assert.ok(r.stdout.includes(`id: ${w.id}`))
    assert.match(r.stdout, /^DEADLINES \[1\]:$/m)
    assert.ok(r.stdout.includes(`id: ${d.id}`))
    // The "elsewhere" action is in the other project; not shown.
    assert.ok(!r.stdout.includes('elsewhere'))
  })

  it('shows project contents even when the project itself is deferred', () => {
    const p = addProject('P')
    const a = addAction('a', { active: true, project: p.id })
    cli('defer', p.id)
    const r = cli('show', p.id)
    assert.match(r.stdout, /^status: deferred$/m)
    assert.match(r.stdout, /^ACTIVE ACTIONS \[1\]:$/m)
    assert.ok(r.stdout.includes(`id: ${a.id}`))
  })

  it('does not embed sub-buckets on non-project entities', () => {
    const a = addAction('a', { active: true })
    const r = cli('show', a.id)
    assert.doesNotMatch(r.stdout, /^ACTIVE ACTIONS/m)
    assert.doesNotMatch(r.stdout, /^WAITING \[/m)
    assert.doesNotMatch(r.stdout, /^DEADLINES/m)
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

  it('clears a due date with --due "" and persists across reads', () => {
    const a = addAction('Email Steve', { active: true, due: '2026-05-03' })
    assert.equal(a.due, '2026-05-03')

    const cleared = parseJson<Action>(cli('edit', a.id, '--due', '').stdout)
    assert.equal(cleared.due, null)
    assert.equal(cleared.title, 'Email Steve')
    assert.equal(cleared.status, 'active')

    const show = cli('show', a.id)
    assert.equal(show.code, 0, show.stderr)
    assert.doesNotMatch(show.stdout, /^due:/m)

    const list = cli('list', 'actions')
    assert.ok(list.stdout.includes(`id: ${a.id}`))
    assert.ok(!list.stdout.includes('  due:'))
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

// ---- Edit --note-append ---------------------------------------------

describe('todo edit <id> --note-append', () => {
  it('sets the note when previously null', () => {
    const a = addAction('A', { active: true })
    assert.equal(a.note, null)
    const r = cli('edit', a.id, '--note-append', 'Tax office phone: 555-1234')
    assert.equal(r.code, 0, r.stderr)
    const out = parseJson<Action>(r.stdout)
    assert.equal(out.note, 'Tax office phone: 555-1234')
  })

  it('appends to an existing note with a blank line between', () => {
    const a = addAction('A', { active: true, note: 'first' })
    const r = cli('edit', a.id, '--note-append', 'second')
    assert.equal(r.code, 0, r.stderr)
    const out = parseJson<Action>(r.stdout)
    assert.equal(out.note, 'first\n\nsecond')
  })

  it('chains multiple appends', () => {
    const p = addProject('P', { note: 'one' })
    cli('edit', p.id, '--note-append', 'two')
    const r = cli('edit', p.id, '--note-append', 'three')
    const out = parseJson<Project>(r.stdout)
    assert.equal(out.note, 'one\n\ntwo\n\nthree')
  })

  it('works on projects, actions, waiting, and deadlines', () => {
    const p = addProject('P')
    const a = addAction('A', { active: true })
    const w = addWaitingItem('W')
    const d = addDeadlineItem('D', { date: FUTURE })
    for (const id of [p.id, a.id, w.id, d.id]) {
      const r = cli('edit', id, '--note-append', 'x')
      assert.equal(r.code, 0, r.stderr)
      const out = parseJson<{ note: string | null }>(r.stdout)
      assert.equal(out.note, 'x')
    }
  })

  it('rejects empty body', () => {
    const a = addAction('A', { active: true })
    const r = cli('edit', a.id, '--note-append', '')
    assert.equal(r.code, 1)
    assert.match(r.stderr, /empty/i)
  })

  it('rejects --note and --note-append in the same call', () => {
    const a = addAction('A', { active: true, note: 'existing' })
    const r = cli('edit', a.id, '--note', 'replaced', '--note-append', 'extra')
    assert.equal(r.code, 1)
    assert.match(r.stderr, /mutually exclusive/i)
  })

  it('combines with other field flags in one call', () => {
    const a = addAction('A', { active: true })
    const r = cli('edit', a.id, '--note-append', 'fact', '--title', 'A renamed')
    assert.equal(r.code, 0, r.stderr)
    const out = parseJson<Action>(r.stdout)
    assert.equal(out.title, 'A renamed')
    assert.equal(out.note, 'fact')
  })

  it('show renders the full multi-line note un-truncated as a block scalar', () => {
    const p = addProject('P')
    cli('edit', p.id, '--note-append', 'Tax office: 555-1234')
    cli('edit', p.id, '--note-append', 'Sarah prefers Tuesdays')
    const r = cli('show', p.id)
    assert.equal(r.code, 0, r.stderr)
    assert.ok(r.stdout.includes('note: |'), r.stdout)
    assert.ok(r.stdout.includes('  Tax office: 555-1234'))
    assert.ok(r.stdout.includes('  Sarah prefers Tuesdays'))
  })

  it('persists the joined note to disk', () => {
    const a = addAction('A', { active: true, note: 'one' })
    cli('edit', a.id, '--note-append', 'two')
    const store = readJson<{ items: Array<{ id: string; note: string | null }> }>(
      join(dataDir, 'store.json'),
    )
    const stored = store.items.find((i) => i.id === a.id)
    assert.equal(stored?.note, 'one\n\ntwo')
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

describe('todo config', () => {
  it('bare config prints data_dir resolved to default when nothing set', () => {
    const home = makeTempDir('todo-home-')
    try {
      const r = runCli(['config'], { home, env: { TODO_DATA_DIR: undefined } })
      assert.equal(r.code, 0, r.stderr)
      assert.match(r.stdout, /^data_dir: .+\.todo\/data$/m)
    } finally {
      cleanup(home)
    }
  })

  it('bare config reflects TODO_DATA_DIR when set', () => {
    const r = cli('config')
    assert.equal(r.code, 0)
    assert.equal(r.stdout.trim(), `data_dir: ${dataDir}`)
  })

  it('config data_dir reads the resolved data_dir', () => {
    const r = cli('config', 'data_dir')
    assert.equal(r.code, 0)
    assert.equal(r.stdout.trim(), `data_dir: ${dataDir}`)
  })

  it('config data_dir <abs-path> writes config and returns JSON', () => {
    const home = makeTempDir('todo-home-')
    const target = makeTempDataDir()
    try {
      const r = runCli(['config', 'data_dir', target], { home, env: { TODO_DATA_DIR: undefined } })
      assert.equal(r.code, 0, r.stderr)
      const out = parseJson<{ data_dir: string }>(r.stdout)
      assert.equal(out.data_dir, target)
      // Re-run read in same sandbox; should reflect the persisted config.
      const r2 = runCli(['config', 'data_dir'], { home, env: { TODO_DATA_DIR: undefined } })
      assert.equal(r2.stdout.trim(), `data_dir: ${target}`)
    } finally {
      cleanup(home)
      cleanup(target)
    }
  })

  it('rejects relative paths in config data_dir <path>', () => {
    const home = makeTempDir('todo-home-')
    try {
      const r = runCli(['config', 'data_dir', 'relative/path'], {
        home,
        env: { TODO_DATA_DIR: undefined },
      })
      assert.equal(r.code, 1)
      assert.match(r.stderr, /absolute path/i)
    } finally {
      cleanup(home)
    }
  })

  it('rejects unknown config keys', () => {
    const r = cli('config', 'nonsense')
    assert.equal(r.code, 1)
    assert.match(r.stderr, /unknown config key/i)
  })

  it('rejects relative TODO_DATA_DIR with a clean error', () => {
    const home = makeTempDir('todo-home-')
    try {
      const r = runCli([], { home, env: { TODO_DATA_DIR: 'rel/data' } })
      assert.equal(r.code, 1)
      assert.match(r.stderr, /absolute path/i)
    } finally {
      cleanup(home)
    }
  })
})

describe('first run', () => {
  it('bare todo returns empty output without ever needing the data dir on disk', () => {
    const home = makeTempDir('todo-home-')
    const dir = join(makeTempDir('todo-data-parent-'), 'never-existed')
    try {
      const r = runCli([], { home, env: { TODO_DATA_DIR: dir } })
      assert.equal(r.code, 0, r.stderr)
      assert.equal(r.stdout, '')
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
    const r = cli()
    assert.equal(r.code, 1)
    assert.match(r.stderr, /malformed store\.json/i)
    // No stack trace line (e.g. "    at ")
    assert.doesNotMatch(r.stderr, /^\s+at /m)
  })
})

// ---- Help -----------------------------------------------------------

describe('help', () => {
  it('--help prints usage and lists commands', () => {
    const r = cli('--help')
    assert.equal(r.code, 0)
    const out = (r.stdout + r.stderr).toLowerCase()
    assert.match(out, /usage: todo/)
    assert.match(out, /list/)
    assert.match(out, /show/)
    assert.match(out, /add/)
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
      assert.match(r.stderr, /date must be in the future/i)
    })

    it('rejects --deferred --start <past>', () => {
      const r = cli('add', 'action', '--title', 'X', '--deferred', '--start', pastDate(1))
      assert.equal(r.code, 1)
      assert.match(r.stderr, /date must be in the future/i)
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
      assert.match(r.stderr, /date must be in the future/i)
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
    it('scheduled actions appear in `list actions` with status deferred', () => {
      const a = addAction('Read DDIA', { deferred: true, start: futureDate(30) })
      const r = cli('list', 'actions')
      assert.ok(r.stdout.includes(`id: ${a.id}`))
      assert.ok(r.stdout.includes('  status: deferred'))
      assert.ok(r.stdout.includes(`  start: ${futureDate(30)}`))
    })

    it('past-due scheduled item appears in dashboard active actions', () => {
      const proj = addProject('P')
      const a = addAction('past', { deferred: true, project: proj.id, start: futureDate(7) })
      const path = join(dataDir, 'store.json')
      const raw = readJson<{ items: Action[]; lists: Project[] }>(path)
      const idx = raw.items.findIndex((i) => i.id === a.id)
      raw.items[idx].start_at = pastDate(1)
      writeFileSync(path, JSON.stringify(raw))

      const r = cli()
      assert.match(r.stdout, /^ACTIVE ACTIONS \[1\]:$/m)
      assert.ok(r.stdout.includes(`id: ${a.id}`))
    })

    it('parent project deferred hides scheduled child from dashboard', () => {
      const proj = addProject('P')
      const child = addAction('child', { deferred: true, project: proj.id, start: futureDate(14) })
      cli('defer', proj.id)
      const r = cli()
      assert.ok(!r.stdout.includes(`id: ${child.id}`))
    })
  })

  describe('schema compatibility', () => {
    it('reads a v0.3-shaped action (no start_at) cleanly via the dashboard', () => {
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
      const r = cli()
      assert.match(r.stdout, /^ACTIVE ACTIONS \[1\]:$/m)
      assert.ok(r.stdout.includes('id: aabbccdd'))
      assert.ok(r.stdout.includes('title: "Old action"'))
    })
  })
})

// ---- Deadlines ------------------------------------------------------

describe('todo add deadline', () => {
  it('creates an active deadline with project and note', () => {
    const proj = addProject('Telepath')
    const d = addDeadlineItem('Q3 launch', { date: FUTURE, project: proj.id, note: 'tracking' })
    assert.equal(d.type, 'deadline')
    assert.equal(d.title, 'Q3 launch')
    assert.equal(d.date, FUTURE)
    assert.equal(d.status, 'active')
    assert.equal(d.closed_at, null)
    assert.equal(d.project, proj.id)
    assert.equal(d.note, 'tracking')
    assert.match(d.id, /^[0-9a-zA-Z]{8}$/)
  })

  it('creates a standalone deadline', () => {
    const d = addDeadlineItem('visa expires', { date: FUTURE })
    assert.equal(d.project, null)
    assert.equal(d.note, null)
  })

  it('rejects past --date', () => {
    const r = cli('add', 'deadline', '--title', 'past', '--date', PAST)
    assert.equal(r.code, 1)
    assert.match(r.stderr, /date must be in the future/i)
  })

  it('rejects today as --date', () => {
    const r = cli('add', 'deadline', '--title', 'today', '--date', 'today')
    assert.equal(r.code, 1)
    assert.match(r.stderr, /date must be in the future/i)
  })

  it('errors on unknown --project', () => {
    const r = cli('add', 'deadline', '--title', 'x', '--date', FUTURE, '--project', 'noSuchPr')
    assert.equal(r.code, 1)
    assert.match(r.stderr, /unknown project/i)
  })

  it('errors when --date is missing', () => {
    const r = cli('add', 'deadline', '--title', 'x')
    assert.equal(r.code, 1)
    assert.match(r.stderr, /required option.*--date/i)
  })

  it('rejects empty title', () => {
    const r = cli('add', 'deadline', '--title', '   ', '--date', FUTURE)
    assert.equal(r.code, 1)
    assert.match(r.stderr, /title is required/i)
  })

  it('resolves natural-language --date via chrono', () => {
    const d = addDeadlineItem('Tomorrow event', { date: 'tomorrow' })
    assert.match(d.date, /^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('todo edit on deadlines', () => {
  it('updates the date on a deadline', () => {
    const d = addDeadlineItem('x', { date: FUTURE })
    const later = ymd(new Date(Date.now() + 60 * 24 * 60 * 60 * 1000))
    const out = parseJson<Deadline>(cli('edit', d.id, '--date', later).stdout)
    assert.equal(out.date, later)
  })

  it('rejects --date "" on deadlines', () => {
    const d = addDeadlineItem('x', { date: FUTURE })
    const r = cli('edit', d.id, '--date', '')
    assert.equal(r.code, 1)
    assert.match(r.stderr, /date is required and cannot be empty/i)
  })

  it('rejects past --date on edit', () => {
    const d = addDeadlineItem('x', { date: FUTURE })
    const r = cli('edit', d.id, '--date', PAST)
    assert.equal(r.code, 1)
    assert.match(r.stderr, /date must be in the future/i)
  })

  it('rejects --due on a deadline', () => {
    const d = addDeadlineItem('x', { date: FUTURE })
    const r = cli('edit', d.id, '--due', '2026-12-31')
    assert.equal(r.code, 1)
    assert.match(r.stderr, /--due.*not allowed.*deadline/i)
  })

  it('rejects --date on an action', () => {
    const a = addAction('x', { active: true })
    const r = cli('edit', a.id, '--date', FUTURE)
    assert.equal(r.code, 1)
    assert.match(r.stderr, /--date.*not allowed.*action/i)
  })

  it('rejects --date on a waiting item', () => {
    const w = addWaitingItem('x')
    const r = cli('edit', w.id, '--date', FUTURE)
    assert.equal(r.code, 1)
    assert.match(r.stderr, /--date.*not allowed.*waiting/i)
  })

  it('rejects --date on a project', () => {
    const p = addProject('p')
    const r = cli('edit', p.id, '--date', FUTURE)
    assert.equal(r.code, 1)
    assert.match(r.stderr, /--date.*not allowed.*project/i)
  })

  it('updates title, note, project on a deadline', () => {
    const proj = addProject('p')
    const d = addDeadlineItem('x', { date: FUTURE })
    const out = parseJson<Deadline>(
      cli('edit', d.id, '--title', 'renamed', '--note', 'n', '--project', proj.id).stdout,
    )
    assert.equal(out.title, 'renamed')
    assert.equal(out.note, 'n')
    assert.equal(out.project, proj.id)
  })
})

describe('lifecycle on deadlines', () => {
  it('rejects complete with the deadline-specific message', () => {
    const d = addDeadlineItem('x', { date: FUTURE })
    const r = cli('complete', d.id)
    assert.equal(r.code, 1)
    assert.match(r.stderr, /cannot complete deadline .*deadlines are not tasks; use drop/i)
  })

  it('rejects defer with the deadline-specific message', () => {
    const d = addDeadlineItem('x', { date: FUTURE })
    const r = cli('defer', d.id)
    assert.equal(r.code, 1)
    assert.match(r.stderr, /cannot defer deadline .*deadlines have no deferred state/i)
  })

  it('drop then activate round-trips', () => {
    const d = addDeadlineItem('x', { date: FUTURE })
    const dropped = parseJson<Deadline>(cli('drop', d.id).stdout)
    assert.equal(dropped.status, 'dropped')
    assert.notEqual(dropped.closed_at, null)
    const reactivated = parseJson<Deadline>(cli('activate', d.id).stdout)
    assert.equal(reactivated.status, 'active')
    assert.equal(reactivated.closed_at, null)
  })
})

describe('todo list with deadlines', () => {
  it('includes active deadlines under the dashboard deadlines bucket', () => {
    const d = addDeadlineItem('Q3', { date: FUTURE })
    const r = cli()
    assert.match(r.stdout, /^DEADLINES \[1\]:$/m)
    assert.ok(r.stdout.includes(`id: ${d.id}`))
  })

  it('hides dropped deadlines from dashboard', () => {
    const d = addDeadlineItem('drop me', { date: FUTURE })
    cli('drop', d.id)
    const r = cli()
    assert.doesNotMatch(r.stdout, /^DEADLINES/m)
  })

  it('hides past-date deadlines from dashboard (via direct store write)', () => {
    mkdirSync(dataDir, { recursive: true })
    const past: Deadline = {
      id: 'pastpast',
      type: 'deadline',
      title: 'expired',
      project: null,
      note: null,
      created_at: '2026-01-01T00:00:00Z',
      status: 'active',
      date: PAST,
      closed_at: null,
    }
    writeFileSync(
      join(dataDir, 'store.json'),
      JSON.stringify({ items: [past], lists: [] }, null, 2) + '\n',
    )
    const r = cli()
    assert.doesNotMatch(r.stdout, /^DEADLINES/m)
  })

  it('past + dropped deadlines are reachable via `list deadlines`', () => {
    const d1 = addDeadlineItem('keep', { date: FUTURE })
    const d2 = addDeadlineItem('drop me', { date: FUTURE })
    cli('drop', d2.id)
    const r = cli('list', 'deadlines')
    assert.ok(r.stdout.includes(`id: ${d1.id}`))
    assert.ok(r.stdout.includes(`id: ${d2.id}`))
    assert.ok(r.stdout.includes('  status: dropped'))
  })

  it('hides deadlines whose parent project is deferred from the dashboard', () => {
    const proj = addProject('P')
    const d = addDeadlineItem('child', { date: FUTURE, project: proj.id })
    cli('defer', proj.id)
    const r = cli()
    assert.ok(!r.stdout.includes(`id: ${d.id}`))
  })
})

// ---- Sub-projects ---------------------------------------------------

describe('todo sub-projects', () => {
  it('add project --parent attaches to a root project', () => {
    const root = addProject('Root')
    const child = addProject('Child', { parent: root.id })
    assert.equal(child.parent, root.id)
    assert.equal(root.parent, null)
  })

  it('add project --parent rejects an unknown parent id', () => {
    const r = cli('add', 'project', '--title', 'Child', '--parent', 'nope1234')
    assert.equal(r.code, 1)
    assert.match(r.stderr, /not found|unknown project/i)
  })

  it('add project --parent rejects a child project (depth-1 limit)', () => {
    const root = addProject('Root')
    const child = addProject('Child', { parent: root.id })
    const r = cli('add', 'project', '--title', 'Grandchild', '--parent', child.id)
    assert.equal(r.code, 1)
    assert.match(r.stderr, /must be a root/i)
  })

  it('add project --parent rejects a non-project id', () => {
    const a = addAction('A', { active: true })
    const r = cli('add', 'project', '--title', 'P', '--parent', a.id)
    assert.equal(r.code, 1)
  })

  it('edit project --parent re-parents and --parent "" detaches', () => {
    const r1 = addProject('R1')
    const r2 = addProject('R2')
    const c = addProject('C')
    const reparented = parseJson<Project>(cli('edit', c.id, '--parent', r1.id).stdout)
    assert.equal(reparented.parent, r1.id)
    const moved = parseJson<Project>(cli('edit', c.id, '--parent', r2.id).stdout)
    assert.equal(moved.parent, r2.id)
    const detached = parseJson<Project>(cli('edit', c.id, '--parent', '').stdout)
    assert.equal(detached.parent, null)
  })

  it('edit project --parent rejects making a project with children into a child', () => {
    const r1 = addProject('R1')
    const r2 = addProject('R2')
    addProject('Child', { parent: r1.id })
    const r = cli('edit', r1.id, '--parent', r2.id)
    assert.equal(r.code, 1)
    assert.match(r.stderr, /has children/i)
  })

  it('edit --parent is rejected on actions, waiting items, deadlines', () => {
    const root = addProject('Root')
    const a = addAction('A', { active: true })
    const w = addWaitingItem('W')
    const d = addDeadlineItem('D', { date: FUTURE })
    for (const id of [a.id, w.id, d.id]) {
      const r = cli('edit', id, '--parent', root.id)
      assert.equal(r.code, 1, `${id}: ${r.stderr}`)
      assert.match(r.stderr, /--parent.*not allowed/i, `${id}: ${r.stderr}`)
    }
  })

  it('dashboard project block shows parent: <title> [<id>] for child projects', () => {
    const root = addProject('NY trip')
    const child = addProject('Sarah meeting', { parent: root.id })
    const r = cli()
    assert.equal(r.code, 0, r.stderr)
    assert.ok(r.stdout.includes(`- id: ${child.id}`))
    assert.ok(r.stdout.includes(`  parent: NY trip [${root.id}]`))
  })

  it('deferring a parent hides both the child project and its items from the dashboard', () => {
    const root = addProject('Root')
    const child = addProject('Child', { parent: root.id })
    const a = addAction('childAction', { active: true, project: child.id })
    let r = cli()
    assert.ok(r.stdout.includes(`id: ${a.id}`))
    assert.ok(r.stdout.includes(`id: ${child.id}`))
    cli('defer', root.id)
    r = cli()
    assert.ok(!r.stdout.includes(`id: ${a.id}`), 'child action should be hidden')
    assert.ok(!r.stdout.includes(`id: ${child.id}`), 'child project should be hidden')
  })

  it('show <root> includes a SUB-PROJECTS section with child counts', () => {
    const root = addProject('NY trip')
    const child = addProject('Sarah meeting', { parent: root.id })
    addAction('book venue', { active: true, project: child.id })
    addAction('email Sarah', { active: true, project: child.id })
    const r = cli('show', root.id)
    assert.equal(r.code, 0, r.stderr)
    assert.ok(r.stdout.includes('SUB-PROJECTS [1]:'), r.stdout)
    assert.ok(r.stdout.includes(`- id: ${child.id}`))
    assert.ok(r.stdout.includes('  title: "Sarah meeting"'))
    assert.ok(r.stdout.includes('  actions: 2'))
  })

  it('show <child> renders the parent reference in the entity block', () => {
    const root = addProject('NY trip')
    const child = addProject('Sarah meeting', { parent: root.id })
    const r = cli('show', child.id)
    assert.equal(r.code, 0, r.stderr)
    assert.match(r.stdout, /^parent: NY trip \[[^\]]+\]$/m)
  })

  it('list projects renders all projects flat with parent on children', () => {
    const root = addProject('Root')
    addProject('Child', { parent: root.id })
    const r = cli('list', 'projects')
    assert.equal(r.code, 0, r.stderr)
    assert.match(r.stdout, /^PROJECTS \[2\]:$/m)
    assert.ok(r.stdout.includes(`  parent: Root [${root.id}]`))
  })
})
