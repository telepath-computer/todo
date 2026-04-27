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
  deadlineModifier,
  dueModifier,
  renderDashboard,
  renderItemLine,
  renderList,
  renderProjectLine,
  renderShow,
  startModifier,
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

  it('handles month boundaries', () => {
    assert.equal(dayDelta('2026-05-01', '2026-04-30'), 1)
  })
})

describe('daysSince', () => {
  it('returns days between an ISO timestamp and today', () => {
    assert.equal(daysSince('2026-04-27T10:00:00Z', '2026-04-27'), 0)
    assert.equal(daysSince('2026-04-20T10:00:00Z', '2026-04-27'), 7)
  })
})

describe('dueModifier', () => {
  it('renders future / today / tomorrow / overdue', () => {
    assert.equal(dueModifier('2026-04-27', '2026-04-27'), 'due 2026-04-27 (today)')
    assert.equal(dueModifier('2026-04-28', '2026-04-27'), 'due 2026-04-28 (tomorrow)')
    assert.equal(dueModifier('2026-05-04', '2026-04-27'), 'due 2026-05-04 (in 7 days)')
    assert.equal(dueModifier('2026-04-26', '2026-04-27'), 'due 2026-04-26 (overdue 1 day)')
    assert.equal(dueModifier('2026-04-20', '2026-04-27'), 'due 2026-04-20 (overdue 7 days)')
  })
})

describe('deadlineModifier', () => {
  it('renders future / today / tomorrow / passed', () => {
    assert.equal(deadlineModifier('2026-04-27', '2026-04-27'), 'date 2026-04-27 (today)')
    assert.equal(deadlineModifier('2026-04-28', '2026-04-27'), 'date 2026-04-28 (tomorrow)')
    assert.equal(deadlineModifier('2026-11-12', '2026-04-27'), 'date 2026-11-12 (in 199 days)')
    assert.equal(deadlineModifier('2026-04-26', '2026-04-27'), 'date 2026-04-26 (passed 1 day ago)')
    assert.equal(deadlineModifier('2026-04-20', '2026-04-27'), 'date 2026-04-20 (passed 7 days ago)')
  })
})

describe('startModifier', () => {
  it('renders revives / revived', () => {
    assert.equal(startModifier('2026-04-27', '2026-04-27'), 'start 2026-04-27 (revives today)')
    assert.equal(startModifier('2026-04-28', '2026-04-27'), 'start 2026-04-28 (revives tomorrow)')
    assert.equal(startModifier('2026-05-04', '2026-04-27'), 'start 2026-05-04 (revives in 7 days)')
    assert.equal(startModifier('2026-04-26', '2026-04-27'), 'start 2026-04-26 (revived 1 day ago)')
  })
})

describe('truncateNote', () => {
  it('passes short notes through', () => {
    assert.equal(truncateNote('hello world'), 'hello world')
  })

  it('truncates at soft word boundary with ellipsis', () => {
    const note = 'a '.repeat(100) // 200 chars; many spaces
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

// ---- Item / project lines -------------------------------------------

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

describe('renderItemLine', () => {
  it('renders an active action with due + project + no note', () => {
    const s = seed()
    const a = s.items.find((i) => i.id === 'A1')!
    assert.equal(
      renderItemLine(a, s, TODAY),
      '- (A1) Find guests — due 2026-04-28 (tomorrow), project Telepath (P1)',
    )
  })

  it('renders an action with note only', () => {
    const s = seed()
    const a = s.items.find((i) => i.id === 'A2')!
    assert.equal(
      renderItemLine(a, s, TODAY),
      '- (A2) Email Steve — note: "follow up on contract"',
    )
  })

  it('renders a waiting item with project and waiting age', () => {
    const s = seed()
    const w = s.items.find((i) => i.id === 'W1')!
    assert.equal(
      renderItemLine(w, s, TODAY),
      '- (W1) Cover art from designer — project Telepath (P1), waiting 12 days',
    )
  })

  it('renders a deadline with date relative + project', () => {
    const s = seed()
    const d = s.items.find((i) => i.id === 'D1')!
    assert.equal(
      renderItemLine(d, s, TODAY),
      '- (D1) Q3 launch — date 2026-11-12 (in 199 days), project Telepath (P1)',
    )
  })

  it('list-mode appends status (and closed when terminal)', () => {
    let s = seed()
    s = setStatus(s, 'A1', { status: 'completed', closed_at: '2026-04-26T10:00:00Z' }).store
    const a = s.items.find((i) => i.id === 'A1')!
    assert.equal(
      renderItemLine(a, s, TODAY, { listMode: true }),
      '- (A1) Find guests — due 2026-04-28 (tomorrow), project Telepath (P1), status completed, closed 2026-04-26T10:00:00Z',
    )
  })

  it('renders a deferred action with start_at', () => {
    const s = seed()
    const a = s.items.find((i) => i.id === 'A4')!
    assert.equal(
      renderItemLine(a, s, TODAY),
      '- (A4) Renew domain — start 2026-05-04 (revives in 7 days)',
    )
  })
})

describe('renderProjectLine', () => {
  it('renders a project with counts', () => {
    const s = seed()
    const p = s.lists[0]
    assert.equal(
      renderProjectLine(p, s),
      '- (P1) Telepath — 1 action, 1 waiting, 1 deadline, note: "Indie thinking tool"',
    )
  })

  it('renders a project with no children with no counts modifier', () => {
    const s = addProject(EMPTY_STORE, { id: 'P9', created_at: T0, title: 'Empty' }).store
    assert.equal(renderProjectLine(s.lists[0], s), '- (P9) Empty')
  })

  it('list-mode appends status', () => {
    const s = seed()
    const p = s.lists[0]
    assert.equal(
      renderProjectLine(p, s, { listMode: true }),
      '- (P1) Telepath — 1 action, 1 waiting, 1 deadline, status active, note: "Indie thinking tool"',
    )
  })
})

// ---- Dashboard, list, show ------------------------------------------

describe('renderDashboard', () => {
  it('renders empty store as empty string', () => {
    assert.equal(renderDashboard(EMPTY_STORE, TODAY), '')
  })

  it('renders all four buckets in canonical order, no Hints when not provided', () => {
    const s = seed()
    const out = renderDashboard(s, TODAY)
    const expected = [
      '# Active actions (2)',
      '- (A1) Find guests — due 2026-04-28 (tomorrow), project Telepath (P1)',
      '- (A2) Email Steve — note: "follow up on contract"',
      '',
      '# Waiting (1)',
      '- (W1) Cover art from designer — project Telepath (P1), waiting 12 days',
      '',
      '# Deadlines (1)',
      '- (D1) Q3 launch — date 2026-11-12 (in 199 days), project Telepath (P1)',
      '',
      '# Active projects (1)',
      '- (P1) Telepath — 1 action, 1 waiting, 1 deadline, note: "Indie thinking tool"',
    ].join('\n')
    assert.equal(out, expected)
  })

  it('omits empty buckets entirely', () => {
    let s: Store = EMPTY_STORE
    s = addAction(s, { id: 'A1', created_at: T0, title: 'Just an action', status: 'active' }).store
    const out = renderDashboard(s, TODAY)
    assert.ok(out.includes('# Active actions'))
    assert.ok(!out.includes('# Waiting'))
    assert.ok(!out.includes('# Deadlines'))
    assert.ok(!out.includes('# Active projects'))
  })

  it('appends Hints when provided', () => {
    const s = seed()
    const out = renderDashboard(s, TODAY, '- a hint\n- another hint\n')
    assert.ok(out.endsWith('# Hints\n- a hint\n- another hint\n'))
  })

  it('does not append Hints heading when hints string is empty', () => {
    const s = seed()
    const out = renderDashboard(s, TODAY, '')
    assert.ok(!out.includes('# Hints'))
  })
})

describe('renderList', () => {
  it('renders all actions regardless of status, with status modifier', () => {
    let s = seed()
    s = setStatus(s, 'A2', { status: 'completed', closed_at: '2026-04-26T10:00:00Z' }).store
    const out = renderList(s, TODAY, 'actions')
    assert.ok(out.startsWith('# Actions (4)'))
    assert.ok(out.includes('- (A1) Find guests'))
    assert.ok(out.includes('status active'))
    assert.ok(out.includes('- (A2) Email Steve'))
    assert.ok(out.includes('status completed'))
    assert.ok(out.includes('closed 2026-04-26T10:00:00Z'))
    assert.ok(out.includes('- (A3) Read DDIA'))
    assert.ok(out.includes('status deferred'))
    assert.ok(out.includes('- (A4) Renew domain'))
  })

  it('renders all projects regardless of status', () => {
    let s = seed()
    s = setStatus(s, 'P1', { status: 'dropped', closed_at: '2026-04-26T10:00:00Z' }).store
    const out = renderList(s, TODAY, 'projects')
    assert.ok(out.startsWith('# Projects (1)'))
    assert.ok(out.includes('status dropped'))
  })

  it('renders deadlines even when past-date or dropped', () => {
    let s = addProject(EMPTY_STORE, { id: 'P1', created_at: T0, title: 'P' }).store
    s = addDeadline(s, { id: 'D1', created_at: T0, title: 'past', date: '2026-04-01' }).store
    s = addDeadline(s, { id: 'D2', created_at: T0, title: 'future', date: '2026-09-01' }).store
    s = setStatus(s, 'D2', { status: 'dropped', closed_at: T0 }).store
    const out = renderList(s, TODAY, 'deadlines')
    assert.ok(out.startsWith('# Deadlines (2)'))
    assert.ok(out.includes('- (D1) past'))
    assert.ok(out.includes('- (D2) future'))
    assert.ok(out.includes('status dropped'))
  })

  it('renders empty types as just the heading', () => {
    assert.equal(renderList(EMPTY_STORE, TODAY, 'actions'), '# Actions (0)')
  })
})

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
      '# Action — Find guests (A1)',
      '- Status: active',
      '- Due: 2026-04-28 (tomorrow)',
      '- Project: Tel (P1)',
      '- Created: 2026-04-27T10:00:00Z',
      '- Note: check Discord',
    ].join('\n')
    assert.equal(renderShow(s, TODAY, result.entity), expected)
  })

  it('renders a waiting item including waiting-days', () => {
    const s = addWaiting(EMPTY_STORE, {
      id: 'W1',
      created_at: '2026-04-15T10:00:00Z',
      title: 'Cover art',
    }).store
    const w = s.items[0]
    const expected = [
      '# Waiting — Cover art (W1)',
      '- Status: active',
      '- Waiting: 12 days',
      '- Project: (none)',
      '- Created: 2026-04-15T10:00:00Z',
      '- Note: (none)',
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
      '# Deadline — Q3 launch (D1)',
      '- Status: active',
      '- Date: 2026-11-12 (in 199 days)',
      '- Project: (none)',
      '- Created: 2026-04-27T10:00:00Z',
      '- Note: (none)',
    ].join('\n')
    assert.equal(renderShow(s, TODAY, d), expected)
  })
})

describe('renderShow project', () => {
  it('renders project header with embedded buckets', () => {
    const s = seed()
    const p = s.lists[0]
    const out = renderShow(s, TODAY, p)
    assert.ok(out.startsWith('# Project — Telepath (P1)'))
    assert.ok(out.includes('## Active actions (1)'))
    assert.ok(out.includes('- (A1) Find guests'))
    assert.ok(out.includes('## Waiting (1)'))
    assert.ok(out.includes('- (W1) Cover art from designer'))
    assert.ok(out.includes('## Deadlines (1)'))
    assert.ok(out.includes('- (D1) Q3 launch'))
  })

  it('shows project contents even when project is deferred', () => {
    let s = seed()
    s = setStatus(s, 'P1', { status: 'deferred', start_at: null }).store
    const p = s.lists[0]
    const out = renderShow(s, TODAY, p)
    assert.ok(out.includes('Status: deferred'))
    assert.ok(out.includes('## Active actions (1)'))
  })

  it('omits empty sub-buckets', () => {
    const s = addProject(EMPTY_STORE, { id: 'P1', created_at: T0, title: 'Empty' }).store
    const p = s.lists[0]
    const out = renderShow(s, TODAY, p)
    assert.ok(out.includes('# Project — Empty (P1)'))
    assert.ok(!out.includes('## Active actions'))
    assert.ok(!out.includes('## Waiting'))
  })

  it('embeds Hints when provided', () => {
    const s = seed()
    const p = s.lists[0]
    const out = renderShow(s, TODAY, p, '- some hint\n')
    assert.ok(out.includes('## Hints\n- some hint\n'))
  })
})

describe('totalDeferredItems', () => {
  it('counts deferred actions and projects together', () => {
    let s = seed()
    s = setStatus(s, 'P1', { status: 'deferred', start_at: null }).store
    // P1 deferred + A3 deferred + A4 deferred (start_at future, deferred bucket)
    assert.equal(totalDeferredItems(s, TODAY), 3)
  })
})
