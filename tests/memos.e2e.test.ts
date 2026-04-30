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
  start_at: string | null
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

function addMemo(note: string, flags: { start?: string; project?: string } = {}): Memo {
  const args = ['add', 'memo', note]
  if (flags.start !== undefined) args.push('--start', flags.start)
  if (flags.project !== undefined) args.push('--project', flags.project)
  const r = cli(...args)
  assert.equal(r.code, 0, r.stderr)
  return parseJson<Memo>(r.stdout)
}

describe('todo add memo', () => {
  it('creates an always-available memo by default', () => {
    const memo = addMemo('Sam is in hospital')
    assert.equal(memo.type, 'memo')
    assert.equal(memo.note, 'Sam is in hospital')
    assert.equal(memo.start_at, null)
    assert.equal(memo.project, null)
  })

  it('round-trips --start through the store', () => {
    const memo = addMemo('Future fact', { start: '2026-05-12' })
    assert.equal(memo.start_at, '2026-05-12')

    const store = readJson<{
      items: Array<Record<string, unknown>>
    }>(join(dataDir, 'store.json'))
    const stored = store.items.find((item) => item.id === memo.id)
    assert.equal(stored?.start_at, '2026-05-12')
  })

  it('creates a future-start project memo', () => {
    const project = addProject('Telepath')
    const memo = addMemo('Keep this in view', { start: futureDate(7), project: project.id })
    assert.equal(memo.start_at, futureDate(7))
    assert.equal(memo.project, project.id)
  })

  it('rejects --pinned', () => {
    const r = cli('add', 'memo', 'old habit', '--pinned')
    assert.equal(r.code, 1)
    assert.match(r.stderr, /unknown option '--pinned'/i)
  })

  it('requires the memo body positional', () => {
    const r = cli('add', 'memo')
    assert.equal(r.code, 1)
    assert.match((r.stdout + r.stderr).toLowerCase(), /missing required argument/i)
  })
})

describe('memo CRUD', () => {
  it('list memo renders newest-first with full multi-line bodies and deferred start hints', () => {
    addMemo('line one\nline two')
    const future = addMemo('future memo', { start: futureDate(7) })
    const r = cli('list', 'memo')
    assert.equal(r.code, 0, r.stderr)
    assert.match(r.stdout, /^MEMOS \[2\]:$/m)
    assert.match(
      r.stdout,
      new RegExp(`- id: ${future.id}[\\s\\S]+note: "future memo"[\\s\\S]+start_at: ${futureDate(7)} \\(starts ${futureDate(7)}, in 7 days\\)`),
    )
    assert.ok(r.stdout.includes('  note: |\n    line one\n    line two'))
    assert.ok(!r.stdout.includes('pinned:'))
  })

  it('show renders a single memo block without a type header', () => {
    const memo = addMemo('remember this\nwith two lines', { start: futureDate(7) })
    const r = cli('show', memo.id)
    assert.equal(r.code, 0, r.stderr)
    assert.ok(r.stdout.startsWith(`- id: ${memo.id}\n`), r.stdout)
    assert.ok(!r.stdout.startsWith('MEMO:'), r.stdout)
    assert.ok(r.stdout.includes('  note: |\n    remember this\n    with two lines'), r.stdout)
    assert.ok(
      r.stdout.includes(`  start_at: ${futureDate(7)} (starts ${futureDate(7)}, in 7 days)`),
      r.stdout,
    )
  })

  it('edit updates note, start date, and project', () => {
    const project = addProject('Telepath')
    const memo = addMemo('old note')
    const r = cli('edit', memo.id, '--note', 'new note', '--start', futureDate(10), '--project', project.id)
    assert.equal(r.code, 0, r.stderr)
    const out = parseJson<Memo>(r.stdout)
    assert.equal(out.note, 'new note')
    assert.equal(out.start_at, futureDate(10))
    assert.equal(out.project, project.id)
  })

  it('edit supports clearing --start and rejects empty notes', () => {
    const memo = addMemo('old note', { start: futureDate(7) })
    let r = cli('edit', memo.id, '--start', '')
    assert.equal(r.code, 0, r.stderr)
    assert.equal(parseJson<Memo>(r.stdout).start_at, null)

    r = cli('edit', memo.id, '--note', '')
    assert.equal(r.code, 1)
    assert.match(r.stderr, /note is required and cannot be empty/i)
  })

  it('edit rejects memo-only flags on non-memo ids', () => {
    const action = addAction('next', { active: true })
    let r = cli('edit', action.id, '--note', 'replacement')
    assert.equal(r.code, 1)
    assert.match(r.stderr, /--note is only allowed on memos/i)
  })

  it('drop hard-deletes memos and returns the last memo JSON', () => {
    const memo = addMemo('remove me', { start: futureDate(7) })
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

describe('memo forward compatibility', () => {
  it('loads an old pinned memo cleanly and drops pinned on save', () => {
    writeFileSync(
      join(dataDir, 'store.json'),
      JSON.stringify({
        lists: [],
        items: [
          {
            id: 'M1',
            type: 'memo',
            note: 'old shape',
            pinned: true,
            project: null,
            created_at: '2026-04-27T10:00:00Z',
          },
        ],
      }, null, 2) + '\n',
    )

    let r = cli('show', 'M1')
    assert.equal(r.code, 0, r.stderr)
    assert.ok(r.stdout.includes('- id: M1'))
    assert.ok(!r.stdout.includes('pinned:'), r.stdout)

    r = cli('edit', 'M1', '--note', 'updated note')
    assert.equal(r.code, 0, r.stderr)
    assert.equal(parseJson<Memo>(r.stdout).start_at, null)

    const store = readJson<{
      items: Array<Record<string, unknown>>
    }>(join(dataDir, 'store.json'))
    const memo = store.items.find((item) => item.id === 'M1')
    assert.equal(memo?.pinned, undefined)
    assert.equal(memo?.start_at, null)
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

    addMemo('newer deferred', { start: futureDate(5), project: activeProject.id })
    addMemo('older available')
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
    assert.ok(r.stdout.includes(`start_at: ${futureDate(5)} (starts ${futureDate(5)}, in 5 days)`))
    assert.ok(!r.stdout.includes('pinned:'))
    assert.ok(r.stdout.includes(`date: ${pastDate(3)}`))
    assert.ok(r.stdout.includes('deadline passed'))
    assert.ok(r.stdout.includes('waiting'))
    assert.ok(!r.stdout.includes('deferred item hidden'))
  })
})
