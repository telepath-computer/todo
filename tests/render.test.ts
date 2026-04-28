import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  EMPTY_STORE,
  addAction,
  addDeadline,
  addProject,
  addWaiting,
  setStatus,
  type Store,
} from '../src/core/model.js'
import {
  dayDelta,
  daysSince,
  quote,
  renderDashboard,
  renderList,
  renderShow,
  totalDeferredItems,
  truncateNote,
} from '../src/core/render.js'

const T0 = '2026-04-27T10:00:00Z'
const TODAY = '2026-04-27'

describe('dayDelta', () => {
  it('returns 0 for the same date', () => {
    assert.equal(dayDelta('2026-04-27', '2026-04-27'), 0)
  })

  it('returns positive for future, negative for past', () => {
    assert.equal(dayDelta('2026-04-28', '2026-04-27'), 1)
    assert.equal(dayDelta('2026-04-26', '2026-04-27'), -1)
    assert.equal(dayDelta('2026-05-27', '2026-04-27'), 30)
    assert.equal(dayDelta('2025-04-27', '2026-04-27'), -365)
  })

  it('handles month boundaries and DST shifts (no fractional days)', () => {
    assert.equal(dayDelta('2026-05-01', '2026-04-30'), 1)
    assert.equal(dayDelta('2026-11-12', '2026-04-27'), 199)
  })
})

describe('daysSince', () => {
  it('returns whole days between an ISO timestamp and today', () => {
    assert.equal(daysSince('2026-04-27T10:00:00Z', '2026-04-27'), 0)
    assert.equal(daysSince('2026-04-20T10:00:00Z', '2026-04-27'), 7)
  })
})

describe('truncateNote', () => {
  it('passes short notes through', () => {
    assert.equal(truncateNote('hello world'), 'hello world')
  })

  it('truncates at soft word boundary with ellipsis', () => {
    const note = 'a '.repeat(100)
    const out = truncateNote(note, 50)
    assert.ok(out.length <= 51)
    assert.ok(out.endsWith('…'))
    assert.ok(!out.includes('  '))
  })

  it('hard-truncates if no good word boundary', () => {
    const long = 'x'.repeat(200)
    const out = truncateNote(long, 50)
    assert.equal(out, 'x'.repeat(50) + '…')
  })
})

describe('quote', () => {
  it('wraps a string in double quotes', () => {
    assert.equal(quote('hello'), '"hello"')
  })

  it('escapes embedded backslashes and quotes', () => {
    assert.equal(quote('say "hi"'), '"say \\"hi\\""')
    assert.equal(quote('a\\b'), '"a\\\\b"')
  })
})

// ---- Seed helper ----------------------------------------------------

function seed(): Store {
  let s: Store = EMPTY_STORE
  s = addProject(s, { id: 'P1', created_at: T0, title: 'Telepath', note: 'Indie thinking tool' }).store
  s = addAction(s, {
    id: 'A1',
    created_at: T0,
    title: 'Find guests',
    status: 'active',
    project: 'P1',
    due: '2026-04-28',
  }).store
  s = addAction(s, {
    id: 'A2',
    created_at: T0,
    title: 'Email Steve',
    status: 'active',
    note: 'follow up on contract',
  }).store
  s = addAction(s, {
    id: 'A3',
    created_at: T0,
    title: 'Read DDIA',
    status: 'deferred',
  }).store
  s = addAction(s, {
    id: 'A4',
    created_at: T0,
    title: 'Renew domain',
    status: 'deferred',
    start_at: '2026-05-04',
  }).store
  s = addWaiting(s, {
    id: 'W1',
    created_at: '2026-04-15T10:00:00Z',
    title: 'Cover art from designer',
    project: 'P1',
  }).store
  s = addDeadline(s, {
    id: 'D1',
    created_at: T0,
    title: 'Q3 launch',
    date: '2026-11-12',
    project: 'P1',
  }).store
  return s
}

// ---- Dashboard ------------------------------------------------------

describe('renderDashboard', () => {
  it('renders empty store as empty string', () => {
    assert.equal(renderDashboard(EMPTY_STORE, TODAY), '')
  })

  it('renders all four buckets in canonical order without status (status implicit)', () => {
    const s = seed()
    const out = renderDashboard(s, TODAY)
    const expected = [
      'ACTIVE ACTIONS [2]:',
      '',
      '- id: A1',
      '  title: "Find guests"',
      '  due: 2026-04-28 (tomorrow)',
      '  project: Telepath [P1]',
      '',
      '- id: A2',
      '  title: "Email Steve"',
      '  note: "follow up on contract"',
      '',
      'WAITING [1]:',
      '',
      '- id: W1',
      '  title: "Cover art from designer"',
      '  project: Telepath [P1]',
      '  age: 12 days',
      '',
      'DEADLINES [1]:',
      '',
      '- id: D1',
      '  title: "Q3 launch"',
      '  date: 2026-11-12 (in 199 days)',
      '  project: Telepath [P1]',
      '',
      'ACTIVE PROJECTS [1]:',
      '',
      '- id: P1',
      '  title: "Telepath"',
      '  actions: 1',
      '  waiting: 1',
      '  deadlines: 1',
      '  note: "Indie thinking tool"',
    ].join('\n')
    assert.equal(out, expected)
  })

  it('omits empty buckets entirely', () => {
    let s: Store = EMPTY_STORE
    s = addAction(s, { id: 'A1', created_at: T0, title: 'Just an action', status: 'active' }).store
    const out = renderDashboard(s, TODAY)
    assert.ok(out.includes('ACTIVE ACTIONS'))
    assert.ok(!out.includes('WAITING'))
    assert.ok(!out.includes('DEADLINES'))
    assert.ok(!out.includes('ACTIVE PROJECTS'))
  })

  it('appends Hints section when provided', () => {
    const s = seed()
    const out = renderDashboard(s, TODAY, '- a hint\n- another hint\n')
    assert.ok(out.endsWith('HINTS:\n\n- a hint\n- another hint'))
  })

  it('does not append Hints heading when hints string is empty', () => {
    const s = seed()
    const out = renderDashboard(s, TODAY, '')
    assert.ok(!out.includes('HINTS:'))
  })

  it('past-due-scheduled action shows up under ACTIVE ACTIONS with start field', () => {
    let s: Store = EMPTY_STORE
    s = addAction(s, {
      id: 'X1',
      created_at: T0,
      title: 'Bridged',
      status: 'deferred',
      start_at: '2026-04-25',
    }).store
    const out = renderDashboard(s, TODAY)
    assert.ok(out.includes('ACTIVE ACTIONS [1]:'))
    assert.ok(out.includes('- id: X1'))
    assert.ok(out.includes('start: 2026-04-25 (revived 2 days ago)'))
    // status omitted in dashboard context
    assert.ok(!out.includes('status:'))
  })
})

// ---- List -----------------------------------------------------------

describe('renderList', () => {
  it('renders all actions regardless of status, with status field', () => {
    let s = seed()
    s = setStatus(s, 'A2', { status: 'completed', closed_at: '2026-04-26T10:00:00Z' }).store
    const out = renderList(s, TODAY, 'actions')
    assert.ok(out.startsWith('ACTIONS [4]:'))
    assert.ok(out.includes('- id: A1'))
    assert.ok(out.includes('  status: active'))
    assert.ok(out.includes('- id: A2'))
    assert.ok(out.includes('  status: completed'))
    assert.ok(out.includes('  closed: 2026-04-26T10:00:00Z'))
    assert.ok(out.includes('- id: A3'))
    assert.ok(out.includes('  status: deferred'))
    assert.ok(out.includes('- id: A4'))
  })

  it('renders all projects regardless of status', () => {
    let s = seed()
    s = setStatus(s, 'P1', { status: 'dropped', closed_at: '2026-04-26T10:00:00Z' }).store
    const out = renderList(s, TODAY, 'projects')
    assert.ok(out.startsWith('PROJECTS [1]:'))
    assert.ok(out.includes('  status: dropped'))
    assert.ok(out.includes('  closed: 2026-04-26T10:00:00Z'))
  })

  it('renders deadlines even when past-date or dropped', () => {
    let s = addProject(EMPTY_STORE, { id: 'P1', created_at: T0, title: 'P' }).store
    s = addDeadline(s, { id: 'D1', created_at: T0, title: 'past', date: '2026-04-01' }).store
    s = addDeadline(s, { id: 'D2', created_at: T0, title: 'future', date: '2026-09-01' }).store
    s = setStatus(s, 'D2', { status: 'dropped', closed_at: T0 }).store
    const out = renderList(s, TODAY, 'deadlines')
    assert.ok(out.startsWith('DEADLINES [2]:'))
    assert.ok(out.includes('- id: D1'))
    assert.ok(out.includes('- id: D2'))
    assert.ok(out.includes('  status: dropped'))
  })

  it('renders empty types as just the count-zero heading', () => {
    assert.equal(renderList(EMPTY_STORE, TODAY, 'actions'), 'ACTIONS [0]:')
  })
})

// ---- Show non-project ----------------------------------------------

describe('renderShow non-projects', () => {
  it('renders an action with all fields populated', () => {
    let s: Store = EMPTY_STORE
    s = addProject(s, { id: 'P1', created_at: T0, title: 'Tel' }).store
    const result = addAction(s, {
      id: 'A1',
      created_at: T0,
      title: 'Find guests',
      status: 'active',
      project: 'P1',
      due: '2026-04-28',
      note: 'check Discord',
    })
    s = result.store
    const expected = [
      'ACTION: "Find guests" [A1]',
      '',
      'status: active',
      'due: 2026-04-28 (tomorrow)',
      'project: Tel [P1]',
      'note: "check Discord"',
      'created: 2026-04-27T10:00:00Z',
    ].join('\n')
    assert.equal(renderShow(s, TODAY, result.entity), expected)
  })

  it('renders a waiting item including age', () => {
    const s = addWaiting(EMPTY_STORE, {
      id: 'W1',
      created_at: '2026-04-15T10:00:00Z',
      title: 'Cover art',
    }).store
    const w = s.items[0]
    const expected = [
      'WAITING: "Cover art" [W1]',
      '',
      'status: active',
      'age: 12 days',
      'created: 2026-04-15T10:00:00Z',
    ].join('\n')
    assert.equal(renderShow(s, TODAY, w), expected)
  })

  it('renders a deadline', () => {
    const s = addDeadline(EMPTY_STORE, {
      id: 'D1',
      created_at: T0,
      title: 'Q3 launch',
      date: '2026-11-12',
    }).store
    const d = s.items[0]
    const expected = [
      'DEADLINE: "Q3 launch" [D1]',
      '',
      'status: active',
      'date: 2026-11-12 (in 199 days)',
      'created: 2026-04-27T10:00:00Z',
    ].join('\n')
    assert.equal(renderShow(s, TODAY, d), expected)
  })

  it('omits the project field when project is null', () => {
    const s = addAction(EMPTY_STORE, {
      id: 'A1',
      created_at: T0,
      title: 'Standalone',
      status: 'active',
    }).store
    const a = s.items[0]
    const out = renderShow(s, TODAY, a)
    assert.ok(!out.includes('project:'))
  })
})

// ---- Show project ---------------------------------------------------

describe('renderShow project', () => {
  it('renders project header + flush-left body + sub-buckets without project ref on children', () => {
    const s = seed()
    const p = s.lists[0]
    const out = renderShow(s, TODAY, p)
    assert.ok(out.startsWith('PROJECT: "Telepath" [P1]'))
    assert.ok(out.includes('\nstatus: active\n'))
    assert.ok(out.includes('\nnote: "Indie thinking tool"'))
    // No counts in the body — sub-buckets enumerate children themselves.
    assert.ok(!/^actions: \d/m.test(out))
    assert.ok(!/^waiting: \d/m.test(out))
    assert.ok(!/^deadlines: \d/m.test(out))
    assert.ok(out.includes('ACTIVE ACTIONS [1]:'))
    assert.ok(out.includes('- id: A1'))
    assert.ok(out.includes('WAITING [1]:'))
    assert.ok(out.includes('- id: W1'))
    assert.ok(out.includes('DEADLINES [1]:'))
    assert.ok(out.includes('- id: D1'))
    // Children inside a project show should not duplicate the project ref.
    assert.ok(!out.includes('  project: Telepath [P1]'))
  })

  it('shows project contents even when project is deferred', () => {
    let s = seed()
    s = setStatus(s, 'P1', { status: 'deferred', start_at: null }).store
    const p = s.lists[0]
    const out = renderShow(s, TODAY, p)
    assert.ok(out.includes('\nstatus: deferred\n'))
    assert.ok(out.includes('ACTIVE ACTIONS [1]:'))
  })

  it('omits empty sub-buckets', () => {
    const s = addProject(EMPTY_STORE, { id: 'P1', created_at: T0, title: 'Empty' }).store
    const p = s.lists[0]
    const out = renderShow(s, TODAY, p)
    assert.ok(out.startsWith('PROJECT: "Empty" [P1]'))
    assert.ok(!out.includes('ACTIVE ACTIONS'))
    assert.ok(!out.includes('WAITING'))
  })

  it('does not render a HINTS section', () => {
    const s = seed()
    const p = s.lists[0]
    const out = renderShow(s, TODAY, p)
    assert.ok(!out.includes('HINTS:'))
  })
})

// ---- Deferred totals ------------------------------------------------

describe('totalDeferredItems', () => {
  it('counts deferred actions and projects together', () => {
    let s = seed()
    s = setStatus(s, 'P1', { status: 'deferred', start_at: null }).store
    // P1 deferred + A3 deferred + A4 deferred (start_at future, deferred bucket)
    assert.equal(totalDeferredItems(s, TODAY), 3)
  })
})
