import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  EMPTY_STORE,
  addAction,
  addDeadline,
  addMemo,
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
  renderReview,
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
  it('renders an empty store as empty output', () => {
    assert.equal(renderDashboard(EMPTY_STORE, TODAY), '')
  })

  it('renders the live buckets in canonical order without status', () => {
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

  it('renders available memos under KEEP IN MIND after ACTIVE PROJECTS and before HINTS', () => {
    let s = seed()
    s = addMemo(s, {
      id: 'M1',
      created_at: '2026-04-28T10:00:00Z',
      note: 'Sam is in hospital',
    }).store
    const out = renderDashboard(s, TODAY, '- a hint\n')
    assert.match(out, /ACTIVE PROJECTS \[1\]:[\s\S]*KEEP IN MIND \[1\]:[\s\S]*HINTS:/)
    assert.ok(out.includes('- id: M1\n  note: "Sam is in hospital"'), out)
  })

  it('KEEP IN MIND only includes available memos, even if their project is deferred', () => {
    let s: Store = EMPTY_STORE
    s = addProject(s, { id: 'P1', created_at: T0, title: 'P' }).store
    s = addMemo(s, {
      id: 'M1',
      created_at: T0,
      note: 'available on a deferred project',
      start_at: TODAY,
      project: 'P1',
    }).store
    s = addMemo(s, {
      id: 'M2',
      created_at: '2026-04-28T10:00:00Z',
      note: 'future memo',
      start_at: '2026-05-04',
    }).store
    s = setStatus(s, 'P1', { status: 'deferred', start_at: null }).store

    const out = renderDashboard(s, TODAY)
    assert.match(out, /^KEEP IN MIND \[1\]:$/m)
    assert.ok(out.includes('- id: M1'))
    assert.ok(out.includes('  start_at: 2026-04-27'))
    assert.ok(!out.includes('(starts 2026-04-27,'), out)
    assert.ok(!out.includes('- id: M2'))
  })

  it('omits KEEP IN MIND when there are no available memos', () => {
    let s: Store = EMPTY_STORE
    s = addMemo(s, { id: 'M1', created_at: T0, note: 'fact', start_at: '2026-05-04' }).store
    assert.doesNotMatch(renderDashboard(s, TODAY), /^KEEP IN MIND/m)
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

  it('renders memos newest-first with full multi-line notes and deferred start hints', () => {
    let s: Store = EMPTY_STORE
    s = addMemo(s, {
      id: 'M1',
      created_at: '2026-04-27T10:00:00Z',
      note: 'line one\nline two',
    }).store
    s = addMemo(s, {
      id: 'M2',
      created_at: '2026-04-28T10:00:00Z',
      note: 'future memo',
      start_at: '2026-05-04',
    }).store
    const out = renderList(s, TODAY, 'memos')
    assert.ok(out.startsWith('MEMOS [2]:'))
    assert.match(out, /- id: M2[\s\S]+start_at: 2026-05-04 \(starts 2026-05-04, in 7 days\)[\s\S]+- id: M1/)
    assert.ok(out.includes('  note: |'))
    assert.ok(out.includes('    line one'))
    assert.ok(out.includes('    line two'))
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

  it('renders memos as a single YAML-like block without a type header', () => {
    const s = addMemo(EMPTY_STORE, {
      id: 'M1',
      created_at: T0,
      note: 'remember this\nwith two lines',
      start_at: '2026-05-04',
    }).store
    const memo = s.items[0]
    const expected = [
      '- id: M1',
      '  note: |',
      '    remember this',
      '    with two lines',
      '  start_at: 2026-05-04 (starts 2026-05-04, in 7 days)',
    ].join('\n')
    assert.equal(renderShow(s, TODAY, memo), expected)
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

describe('renderReview', () => {
  it('renders memos, deferred sections, lapsed deadlines, and hints in review order', () => {
    let s: Store = EMPTY_STORE
    s = addProject(s, { id: 'P1', created_at: T0, title: 'Telepath' }).store
    s = addProject(s, { id: 'P2', created_at: T0, title: 'Later' }).store
    s = setStatus(s, 'P2', { status: 'deferred', start_at: null }).store
    s = addMemo(s, { id: 'M1', created_at: '2026-04-27T10:00:00Z', note: 'older available' }).store
    s = addMemo(s, {
      id: 'M2',
      created_at: '2026-04-28T10:00:00Z',
      note: 'newer deferred',
      start_at: '2026-05-04',
    }).store
    s = addAction(s, { id: 'A1', created_at: T0, title: 'next', status: 'active', project: 'P1' }).store
    s = addAction(s, { id: 'A2', created_at: T0, title: 'later', status: 'deferred' }).store
    s = addWaiting(s, { id: 'W1', created_at: '2026-04-15T10:00:00Z', title: 'reply', project: 'P1' }).store
    s = addDeadline(s, { id: 'D1', created_at: T0, title: 'lapsed', date: '2026-04-20', project: 'P1' }).store

    const out = renderReview(s, TODAY, '- stale waiting\n')
    assert.match(
      out,
      /^MEMOS \[2\]:[\s\S]*ACTIVE ACTIONS \[1\]:[\s\S]*DEFERRED ACTIONS \[1\]:[\s\S]*WAITING \[1\]:[\s\S]*DEADLINES \[1\]:[\s\S]*ACTIVE PROJECTS \[1\]:[\s\S]*DEFERRED PROJECTS \[1\]:[\s\S]*HINTS:/,
    )
    assert.match(out, /- id: M2[\s\S]+start_at: 2026-05-04 \(starts 2026-05-04, in 7 days\)[\s\S]+- id: M1/)
    assert.ok(out.includes('  date: 2026-04-20 (passed 7 days ago)'))
    assert.ok(out.endsWith('HINTS:\n\n- stale waiting'))
  })
})

// ---- Show: full notes (no truncation, multi-line block scalar) ------

describe('renderShow note rendering', () => {
  it('renders a single-line note as a quoted scalar in show', () => {
    let s: Store = EMPTY_STORE
    const r = addProject(s, { id: 'P1', created_at: T0, title: 'P', note: 'one liner' })
    s = r.store
    const out = renderShow(s, TODAY, r.entity)
    assert.match(out, /^note: "one liner"$/m)
  })

  it('renders a multi-line note as a block scalar with indented continuation', () => {
    let s: Store = EMPTY_STORE
    const note = 'fact one\n\nfact two\n\nfact three'
    const r = addProject(s, { id: 'P1', created_at: T0, title: 'P', note })
    s = r.store
    const out = renderShow(s, TODAY, r.entity)
    const expected = ['note: |', '  fact one', '  ', '  fact two', '  ', '  fact three'].join('\n')
    assert.ok(out.includes(expected), `expected block scalar in:\n${out}`)
  })

  it('does not truncate a long single-line note in show', () => {
    let s: Store = EMPTY_STORE
    const long = 'x'.repeat(500)
    const r = addProject(s, { id: 'P1', created_at: T0, title: 'P', note: long })
    s = r.store
    const out = renderShow(s, TODAY, r.entity)
    assert.ok(out.includes(`note: "${long}"`))
    assert.ok(!out.includes('…'))
  })

  it('renders a multi-line note on a non-project entity in show', () => {
    let s: Store = EMPTY_STORE
    const r = addAction(s, {
      id: 'A1',
      created_at: T0,
      title: 'A',
      status: 'active',
      note: 'line one\nline two',
    })
    s = r.store
    const out = renderShow(s, TODAY, r.entity)
    assert.ok(out.includes('note: |\n  line one\n  line two'), `got:\n${out}`)
  })

  it('keeps truncating notes on the dashboard', () => {
    let s: Store = EMPTY_STORE
    const long = 'x'.repeat(300)
    s = addProject(s, { id: 'P1', created_at: T0, title: 'P', note: long }).store
    const out = renderDashboard(s, TODAY)
    assert.ok(out.includes('…'))
    assert.ok(!out.includes('x'.repeat(200)))
  })

  it('keeps truncating notes in list view', () => {
    let s: Store = EMPTY_STORE
    const long = 'x'.repeat(300)
    s = addProject(s, { id: 'P1', created_at: T0, title: 'P', note: long }).store
    const out = renderList(s, TODAY, 'projects')
    assert.ok(out.includes('…'))
  })

  it('flattens a multi-line note to a single line on the dashboard', () => {
    let s: Store = EMPTY_STORE
    s = addProject(s, {
      id: 'P1',
      created_at: T0,
      title: 'P',
      note: 'first paragraph\n\nsecond paragraph',
    }).store
    const out = renderDashboard(s, TODAY)
    // No literal newline inside the rendered note value (would break the YAML-ish block).
    assert.doesNotMatch(out, /note: "first paragraph\n/)
    // The first paragraph still appears.
    assert.ok(out.includes('first paragraph'))
  })
})

// ---- Sub-projects ---------------------------------------------------

describe('sub-projects rendering', () => {
  function rootWithChild(): Store {
    let s: Store = EMPTY_STORE
    s = addProject(s, { id: 'R', created_at: T0, title: 'Root' }).store
    s = addProject(s, { id: 'C', created_at: T0, title: 'Child', parent: 'R' }).store
    return s
  }

  it('dashboard project block omits parent for root projects', () => {
    let s: Store = EMPTY_STORE
    s = addProject(s, { id: 'P', created_at: T0, title: 'Solo' }).store
    const out = renderDashboard(s, TODAY)
    assert.match(out, /^- id: P$/m)
    assert.doesNotMatch(out, /^\s+parent:/m)
  })

  it('dashboard project block shows parent: <title> [<id>] for child projects', () => {
    const s = rootWithChild()
    const out = renderDashboard(s, TODAY)
    assert.ok(out.includes('- id: C'))
    assert.ok(out.includes('  parent: Root [R]'))
    // Root itself does NOT get a parent field.
    const rootBlock = out.split('- id: R')[1]?.split('- id: C')[0] ?? ''
    assert.doesNotMatch(rootBlock, /\bparent:/)
  })

  it('renderShow on a root with children includes a SUB-PROJECTS section', () => {
    const s = rootWithChild()
    const out = renderShow(s, TODAY, s.lists[0])
    assert.ok(out.includes('SUB-PROJECTS [1]:'), out)
    assert.ok(out.includes('- id: C'))
    assert.ok(out.includes('  title: "Child"'))
    // Children inside a sub-projects section don't repeat the parent field.
    assert.doesNotMatch(out, /SUB-PROJECTS[\s\S]*\bparent: Root/)
  })

  it('renderShow on a root without children omits SUB-PROJECTS', () => {
    let s: Store = EMPTY_STORE
    s = addProject(s, { id: 'P', created_at: T0, title: 'Solo' }).store
    const out = renderShow(s, TODAY, s.lists[0])
    assert.ok(!out.includes('SUB-PROJECTS'))
  })

  it('renderShow on a child includes parent in the entity field block', () => {
    const s = rootWithChild()
    const child = s.lists.find((l) => l.id === 'C')!
    const out = renderShow(s, TODAY, child)
    assert.ok(out.startsWith('PROJECT: "Child" [C]'), out)
    assert.match(out, /^parent: Root \[R\]$/m)
  })

  it('list projects renders parent on children, omits on roots', () => {
    const s = rootWithChild()
    const out = renderList(s, TODAY, 'projects')
    assert.match(out, /^PROJECTS \[2\]:$/m)
    const childBlock = out.split('- id: C')[1] ?? ''
    assert.match(childBlock, /\bparent: Root \[R\]/)
    const rootBlock = out.split('- id: R')[1]?.split('- id: C')[0] ?? ''
    assert.doesNotMatch(rootBlock, /\bparent:/)
  })

  it('parent count rolls up sub-project items as a parenthetical suffix', () => {
    let s: Store = EMPTY_STORE
    s = addProject(s, { id: 'R', created_at: T0, title: 'Root' }).store
    s = addProject(s, { id: 'C', created_at: T0, title: 'Child', parent: 'R' }).store
    s = addAction(s, { id: 'A', created_at: T0, title: 'a', status: 'active', project: 'C' }).store
    s = addWaiting(s, { id: 'W', created_at: T0, title: 'w', project: 'C' }).store
    const out = renderDashboard(s, TODAY)
    const rootBlock = out.split('- id: R')[1]?.split('- id: C')[0] ?? ''
    assert.match(rootBlock, /actions: 0 \(\+1 in sub-projects\)/)
    assert.match(rootBlock, /waiting: 0 \(\+1 in sub-projects\)/)
    assert.match(rootBlock, /deadlines: 0$/m)
  })

  it('does not append a sub-projects suffix on child project blocks', () => {
    let s: Store = EMPTY_STORE
    s = addProject(s, { id: 'R', created_at: T0, title: 'Root' }).store
    s = addProject(s, { id: 'C', created_at: T0, title: 'Child', parent: 'R' }).store
    s = addAction(s, { id: 'A', created_at: T0, title: 'a', status: 'active', project: 'C' }).store
    const out = renderDashboard(s, TODAY)
    const childBlock = out.split('- id: C')[1] ?? ''
    assert.doesNotMatch(childBlock, /sub-projects/)
  })

  it('omits the suffix when sub-projects have no items', () => {
    let s: Store = EMPTY_STORE
    s = addProject(s, { id: 'R', created_at: T0, title: 'Root' }).store
    s = addProject(s, { id: 'C', created_at: T0, title: 'Child', parent: 'R' }).store
    const out = renderDashboard(s, TODAY)
    const rootBlock = out.split('- id: R')[1]?.split('- id: C')[0] ?? ''
    assert.match(rootBlock, /actions: 0$/m)
    assert.doesNotMatch(rootBlock, /sub-projects/)
  })

  it('combines own and sub-project items: parent shows N (+M in sub-projects)', () => {
    let s: Store = EMPTY_STORE
    s = addProject(s, { id: 'R', created_at: T0, title: 'Root' }).store
    s = addProject(s, { id: 'C', created_at: T0, title: 'Child', parent: 'R' }).store
    s = addAction(s, { id: 'A1', created_at: T0, title: 'parent action', status: 'active', project: 'R' }).store
    s = addAction(s, { id: 'A2', created_at: T0, title: 'child action', status: 'active', project: 'C' }).store
    s = addAction(s, { id: 'A3', created_at: T0, title: 'child action 2', status: 'active', project: 'C' }).store
    const out = renderDashboard(s, TODAY)
    const rootBlock = out.split('- id: R')[1]?.split('- id: C')[0] ?? ''
    assert.match(rootBlock, /actions: 1 \(\+2 in sub-projects\)/)
  })

  it('rollup excludes terminal items', () => {
    let s: Store = EMPTY_STORE
    s = addProject(s, { id: 'R', created_at: T0, title: 'Root' }).store
    s = addProject(s, { id: 'C', created_at: T0, title: 'Child', parent: 'R' }).store
    s = addAction(s, { id: 'A1', created_at: T0, title: 'live', status: 'active', project: 'C' }).store
    s = addAction(s, { id: 'A2', created_at: T0, title: 'done', status: 'active', project: 'C' }).store
    s = setStatus(s, 'A2', { status: 'completed', closed_at: T0 }).store
    const out = renderDashboard(s, TODAY)
    const rootBlock = out.split('- id: R')[1]?.split('- id: C')[0] ?? ''
    assert.match(rootBlock, /actions: 0 \(\+1 in sub-projects\)/)
  })
})
