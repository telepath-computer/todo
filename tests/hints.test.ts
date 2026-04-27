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
  deferredCount,
  recentLapsedDeadlines,
  renderHints,
  staleWaiting,
  stalledActiveProjects,
} from '../src/core/hints.js'

const T0 = '2026-04-27T10:00:00Z'
const TODAY = '2026-04-27'

describe('recentLapsedDeadlines', () => {
  it('flags an active deadline whose date passed within the last 7 days', () => {
    const s = addDeadline(EMPTY_STORE, {
      id: 'D1',
      created_at: T0,
      title: 'Tax filing day',
      date: '2026-04-23',
    }).store
    const out = recentLapsedDeadlines(s, TODAY)
    assert.deepEqual(out, [
      "- (D1) Tax filing day deadline passed 4 days ago. Confirm with the user it's grokked, then `todo drop D1`.",
    ])
  })

  it('uses singular "day" at exactly 1 day ago', () => {
    const s = addDeadline(EMPTY_STORE, {
      id: 'D1',
      created_at: T0,
      title: 'X',
      date: '2026-04-26',
    }).store
    const out = recentLapsedDeadlines(s, TODAY)
    assert.ok(out[0].includes('passed 1 day ago'))
  })

  it('does not flag deadlines that lapsed more than 7 days ago', () => {
    const s = addDeadline(EMPTY_STORE, {
      id: 'D1',
      created_at: T0,
      title: 'X',
      date: '2026-04-15',
    }).store
    assert.deepEqual(recentLapsedDeadlines(s, TODAY), [])
  })

  it('does not flag future deadlines', () => {
    const s = addDeadline(EMPTY_STORE, {
      id: 'D1',
      created_at: T0,
      title: 'X',
      date: '2026-09-01',
    }).store
    assert.deepEqual(recentLapsedDeadlines(s, TODAY), [])
  })

  it('does not flag dropped deadlines', () => {
    let s = addDeadline(EMPTY_STORE, {
      id: 'D1',
      created_at: T0,
      title: 'X',
      date: '2026-04-23',
    }).store
    s = setStatus(s, 'D1', { status: 'dropped', closed_at: T0 }).store
    assert.deepEqual(recentLapsedDeadlines(s, TODAY), [])
  })
})

describe('stalledActiveProjects', () => {
  it('flags an active project with non-action children but zero active actions', () => {
    let s: Store = EMPTY_STORE
    s = addProject(s, { id: 'P1', created_at: T0, title: 'Telepath' }).store
    s = addWaiting(s, { id: 'W1', created_at: T0, title: 'cover art', project: 'P1' }).store
    s = addDeadline(s, { id: 'D1', created_at: T0, title: 'launch', date: '2026-09-01', project: 'P1' }).store
    const out = stalledActiveProjects(s, TODAY)
    assert.deepEqual(out, [
      '- (P1) Telepath: no active actions, 1 waiting, 1 deadline. Either blocked on a waiting item, needs a next action defined, or consider `todo defer P1`.',
    ])
  })

  it('does not flag a project with zero children', () => {
    const s = addProject(EMPTY_STORE, { id: 'P1', created_at: T0, title: 'Empty' }).store
    assert.deepEqual(stalledActiveProjects(s, TODAY), [])
  })

  it('does not flag a project that has at least one active action', () => {
    let s: Store = EMPTY_STORE
    s = addProject(s, { id: 'P1', created_at: T0, title: 'P' }).store
    s = addAction(s, { id: 'A1', created_at: T0, title: 'a', status: 'active', project: 'P1' }).store
    assert.deepEqual(stalledActiveProjects(s, TODAY), [])
  })

  it('counts a past-due scheduled action as active for stall purposes', () => {
    let s: Store = EMPTY_STORE
    s = addProject(s, { id: 'P1', created_at: T0, title: 'P' }).store
    s = addAction(s, {
      id: 'A1',
      created_at: T0,
      title: 'past-due scheduled',
      status: 'deferred',
      project: 'P1',
      start_at: '2026-04-20',
    }).store
    s = addWaiting(s, { id: 'W1', created_at: T0, title: 'w', project: 'P1' }).store
    assert.deepEqual(stalledActiveProjects(s, TODAY), [])
  })

  it('does not flag a deferred project', () => {
    let s: Store = EMPTY_STORE
    s = addProject(s, { id: 'P1', created_at: T0, title: 'P' }).store
    s = addWaiting(s, { id: 'W1', created_at: T0, title: 'w', project: 'P1' }).store
    s = setStatus(s, 'P1', { status: 'deferred', start_at: null }).store
    assert.deepEqual(stalledActiveProjects(s, TODAY), [])
  })
})

describe('staleWaiting', () => {
  it('flags an active waiting item older than 7 days', () => {
    const s = addWaiting(EMPTY_STORE, {
      id: 'W1',
      created_at: '2026-04-15T10:00:00Z',
      title: 'Cover art',
    }).store
    const out = staleWaiting(s, TODAY)
    assert.deepEqual(out, ['- (W1) Cover art waiting 12 days. Worth a follow-up?'])
  })

  it('does not flag waiting items 7 days old or younger', () => {
    const s = addWaiting(EMPTY_STORE, {
      id: 'W1',
      created_at: '2026-04-20T10:00:00Z',
      title: 'recent',
    }).store
    assert.deepEqual(staleWaiting(s, TODAY), [])
  })

  it('does not flag terminal waiting items', () => {
    let s = addWaiting(EMPTY_STORE, {
      id: 'W1',
      created_at: '2026-04-15T10:00:00Z',
      title: 'X',
    }).store
    s = setStatus(s, 'W1', { status: 'completed', closed_at: T0 }).store
    assert.deepEqual(staleWaiting(s, TODAY), [])
  })
})

describe('deferredCount', () => {
  it('returns one bullet when at least one deferred item exists', () => {
    let s: Store = EMPTY_STORE
    s = addAction(s, { id: 'A1', created_at: T0, title: 'someday', status: 'deferred' }).store
    s = addAction(s, { id: 'A2', created_at: T0, title: 'someday2', status: 'deferred' }).store
    assert.deepEqual(deferredCount(s, TODAY), [
      '- 2 deferred items hidden. `todo list actions` / `todo list projects` to inspect.',
    ])
  })

  it('uses singular when count is 1', () => {
    const s = addAction(EMPTY_STORE, {
      id: 'A1',
      created_at: T0,
      title: 'X',
      status: 'deferred',
    }).store
    assert.deepEqual(deferredCount(s, TODAY), [
      '- 1 deferred item hidden. `todo list actions` / `todo list projects` to inspect.',
    ])
  })

  it('returns nothing when no deferred items', () => {
    assert.deepEqual(deferredCount(EMPTY_STORE, TODAY), [])
  })
})

describe('renderHints', () => {
  it('returns empty string when no triggers fire', () => {
    assert.equal(renderHints(EMPTY_STORE, TODAY), '')
  })

  it('orders triggers: lapsed → stalled → stale → deferred-count', () => {
    let s: Store = EMPTY_STORE
    // Lapsed deadline (recent)
    s = addDeadline(s, { id: 'D1', created_at: T0, title: 'Tax day', date: '2026-04-23' }).store
    // Stalled active project
    s = addProject(s, { id: 'P1', created_at: T0, title: 'Telepath' }).store
    s = addWaiting(s, {
      id: 'W1',
      created_at: '2026-04-15T10:00:00Z',
      title: 'Cover art',
      project: 'P1',
    }).store
    // Stale waiting (W1 above is also stale — 12 days)
    // Deferred count
    s = addAction(s, { id: 'A1', created_at: T0, title: 'someday', status: 'deferred' }).store

    const out = renderHints(s, TODAY)
    const lines = out.trim().split('\n')
    assert.equal(lines.length, 4)
    assert.ok(lines[0].includes('Tax day deadline passed'))
    assert.ok(lines[1].includes('Telepath: no active actions'))
    assert.ok(lines[2].includes('Cover art waiting 12 days'))
    assert.ok(lines[3].includes('1 deferred item hidden'))
    assert.ok(out.endsWith('\n'))
  })
})
