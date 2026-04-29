import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { cleanup, makeTempDataDir, parseJson, readJson, runCli } from './helpers.js'

type Project = {
  id: string
  type: 'project'
  title: string
  status: 'active' | 'deferred' | 'completed' | 'dropped'
}

type Action = {
  id: string
  type: 'action'
  title: string
  status: 'active' | 'deferred' | 'completed' | 'dropped'
  start_at: string | null
}

type Deadline = {
  id: string
  type: 'deadline'
  title: string
  date: string
  status: 'active' | 'dropped'
}

type Memo = {
  id: string
  type: 'memo'
  note: string
  pinned: boolean
  project: string | null
  created_at: string
}

let dataDir: string

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

function pastDate(daysBack = 3): string {
  const d = new Date()
  d.setDate(d.getDate() - daysBack)
  return ymd(d)
}

beforeEach(() => {
  dataDir = makeTempDataDir()
})

afterEach(() => {
  cleanup(dataDir)
})

function cli(...args: string[]) {
  return runCli(args, { dataDir })
}

function addProject(title: string): Project {
  const r = cli('add', 'project', title)
  assert.equal(r.code, 0, r.stderr)
  return parseJson<Project>(r.stdout)
}

function addAction(title: string, flags: { active?: boolean; deferred?: boolean; start?: string } = {}): Action {
  const args = ['add', 'action', title]
  if (flags.active) args.push('--active')
  if (flags.deferred) args.push('--deferred')
  if (flags.start !== undefined) args.push('--start', flags.start)
  const r = cli(...args)
  assert.equal(r.code, 0, r.stderr)
  return parseJson<Action>(r.stdout)
}

function addDeadline(title: string, date: string): Deadline {
  const r = cli('add', 'deadline', title, '--date', date)
  assert.equal(r.code, 0, r.stderr)
  return parseJson<Deadline>(r.stdout)
}

function addMemo(note: string, flags: { pinned?: boolean; project?: string } = {}): Memo {
  const args = ['add', 'memo', note]
  if (flags.pinned) args.push('--pinned')
  if (flags.project !== undefined) args.push('--project', flags.project)
  const r = cli(...args)
  assert.equal(r.code, 0, r.stderr)
  return parseJson<Memo>(r.stdout)
}

describe('todo add memo', () => {
  it('creates an unpinned memo by default', () => {
    const memo = addMemo('Sam is in hospital')
    assert.equal(memo.type, 'memo')
    assert.equal(memo.note, 'Sam is in hospital')
    assert.equal(memo.pinned, false)
    assert.equal(memo.project, null)
  })

  it('creates a pinned project memo', () => {
    const project = addProject('Telepath')
    const memo = addMemo('Keep this in view', { pinned: true, project: project.id })
    assert.equal(memo.pinned, true)
    assert.equal(memo.project, project.id)
  })

  it('requires the memo body positional', () => {
    const r = cli('add', 'memo')
    assert.equal(r.code, 1)
    assert.match((r.stdout + r.stderr).toLowerCase(), /missing required argument/i)
  })
})

describe('memo CRUD', () => {
  it('list memo renders pinned-first with full multi-line bodies', () => {
    addMemo('line one\nline two')
    const pinned = addMemo('pinned first', { pinned: true })
    const r = cli('list', 'memo')
    assert.equal(r.code, 0, r.stderr)
    assert.match(r.stdout, /^MEMOS \[2\]:$/m)
    assert.match(r.stdout, new RegExp(`- id: ${pinned.id}[\\s\\S]+note: "pinned first"[\\s\\S]+pinned: true`))
    assert.ok(r.stdout.includes('  note: |\n    line one\n    line two'))
    assert.ok(r.stdout.includes('  pinned: false'))
  })

  it('show renders a single memo block without a type header', () => {
    const memo = addMemo('remember this\nwith two lines', { pinned: true })
    const r = cli('show', memo.id)
    assert.equal(r.code, 0, r.stderr)
    assert.ok(r.stdout.startsWith(`- id: ${memo.id}\n`), r.stdout)
    assert.ok(!r.stdout.startsWith('MEMO:'), r.stdout)
    assert.ok(r.stdout.includes('  note: |\n    remember this\n    with two lines'), r.stdout)
    assert.ok(r.stdout.includes('  pinned: true'), r.stdout)
  })

  it('edit updates note, pinned state, and project', () => {
    const project = addProject('Telepath')
    const memo = addMemo('old note')
    const r = cli('edit', memo.id, '--note', 'new note', '--pinned', '--project', project.id)
    assert.equal(r.code, 0, r.stderr)
    const out = parseJson<Memo>(r.stdout)
    assert.equal(out.note, 'new note')
    assert.equal(out.pinned, true)
    assert.equal(out.project, project.id)
  })

  it('edit supports --no-pinned and rejects empty notes', () => {
    const memo = addMemo('old note', { pinned: true })
    let r = cli('edit', memo.id, '--no-pinned')
    assert.equal(r.code, 0, r.stderr)
    assert.equal(parseJson<Memo>(r.stdout).pinned, false)

    r = cli('edit', memo.id, '--note', '')
    assert.equal(r.code, 1)
    assert.match(r.stderr, /note is required and cannot be empty/i)
  })

  it('edit rejects memo-only flags on non-memo ids', () => {
    const action = addAction('next', { active: true })
    let r = cli('edit', action.id, '--note', 'replacement')
    assert.equal(r.code, 1)
    assert.match(r.stderr, /--note is only allowed on memos/i)

    r = cli('edit', action.id, '--pinned')
    assert.equal(r.code, 1)
    assert.match(r.stderr, /--pinned is only allowed on memos/i)
  })

  it('drop hard-deletes memos and returns the last memo JSON', () => {
    const memo = addMemo('remove me', { pinned: true })
    const dropped = cli('drop', memo.id)
    assert.equal(dropped.code, 0, dropped.stderr)
    assert.deepEqual(parseJson<Memo>(dropped.stdout), memo)

    let r = cli('show', memo.id)
    assert.equal(r.code, 1)
    assert.match(r.stderr, new RegExp(`not found: ${memo.id}`))

    r = cli('edit', memo.id, '--note', 'new')
    assert.equal(r.code, 1)
    assert.match(r.stderr, new RegExp(`not found: ${memo.id}`))
  })
})

describe('memo lifecycle restrictions', () => {
  it('activate, defer, and complete reject memo ids', () => {
    const memo = addMemo('fact')

    for (const args of [
      ['activate', memo.id],
      ['defer', memo.id],
      ['complete', memo.id],
    ]) {
      const r = cli(...args)
      assert.equal(r.code, 1)
      assert.match(r.stderr, new RegExp(`${memo.id} is a memo and has no status`))
    }
  })
})

describe('todo review', () => {
  it('renders all memos plus deferred projects/actions and lapsed deadlines', () => {
    const activeProject = addProject('Telepath')
    const deferredProject = addProject('Later')
    cli('defer', deferredProject.id)

    addMemo('newest pinned', { pinned: true, project: activeProject.id })
    addMemo('older unpinned')
    addAction('next action', { active: true })
    addAction('someday', { deferred: true })
    const staleWaiting = cli('add', 'waiting', 'reply from Sam')
    assert.equal(staleWaiting.code, 0, staleWaiting.stderr)
    const waiting = parseJson<{ id: string }>(staleWaiting.stdout)
    const deadline = addDeadline('tax filing', futureDate(30))

    const store = readJson<{
      lists: unknown[]
      items: Array<Record<string, unknown>>
    }>(join(dataDir, 'store.json'))
    const items = store.items.map((item) => {
      if (item.id === waiting.id) {
        return { ...item, created_at: '2026-04-10T00:00:00Z' }
      }
      if (item.id === deadline.id) {
        return { ...item, date: pastDate(3) }
      }
      return item
    })
    writeFileSync(join(dataDir, 'store.json'), JSON.stringify({ ...store, items }, null, 2) + '\n')

    const r = cli('review')
    assert.equal(r.code, 0, r.stderr)
    assert.match(
      r.stdout,
      /^MEMOS \[2\]:[\s\S]*ACTIVE ACTIONS \[1\]:[\s\S]*DEFERRED ACTIONS \[1\]:[\s\S]*WAITING \[1\]:[\s\S]*DEADLINES \[1\]:[\s\S]*ACTIVE PROJECTS \[1\]:[\s\S]*DEFERRED PROJECTS \[1\]:[\s\S]*HINTS:/,
    )
    assert.ok(r.stdout.includes('pinned: true'))
    assert.ok(r.stdout.includes('pinned: false'))
    assert.ok(r.stdout.includes(`date: ${pastDate(3)}`))
    assert.ok(r.stdout.includes('deadline passed'))
    assert.ok(r.stdout.includes('waiting'))
    assert.ok(!r.stdout.includes('deferred item hidden'))
  })
})
