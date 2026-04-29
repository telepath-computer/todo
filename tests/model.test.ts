import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { InvalidArgument, NotFound, NothingToEdit } from '../src/core/errors.js'
import {
  EMPTY_STORE,
  activeDeadlines,
  activeProjects,
  addAction,
  addDeadline,
  addProject,
  addWaiting,
  appendNote,
  deferredActions,
  deferredProjects,
  editItem,
  editList,
  findChildren,
  findEntity,
  findItem,
  findList,
  isTerminal,
  liveActions,
  liveWaiting,
  resolveRef,
  setStatus,
  type ActionItem,
  type DeadlineItem,
  type ProjectList,
  type Store,
  type WaitingItem,
} from '../src/core/model.js'

const T0 = '2026-04-27T10:00:00Z'
const TODAY = '2026-04-27'
const FUTURE = '2026-09-01'
const PAST = '2026-01-01'

function seed(): Store {
  let s: Store = EMPTY_STORE
  s = addProject(s, { id: 'P1', created_at: T0, title: 'Proj A' }).store
  s = addProject(s, { id: 'P2', created_at: T0, title: 'Proj B' }).store
  s = addAction(s, { id: 'A1', created_at: T0, title: 'A1 task', status: 'active', project: 'P1' }).store
  s = addAction(s, { id: 'A2', created_at: T0, title: 'A2 task', status: 'deferred', project: 'P1' }).store
  s = addAction(s, { id: 'A3', created_at: T0, title: 'standalone', status: 'active', project: null }).store
  s = addWaiting(s, { id: 'W1', created_at: T0, title: 'cover art', project: 'P1' }).store
  return s
}

describe('isTerminal', () => {
  it('returns true for completed/dropped, false otherwise', () => {
    assert.equal(isTerminal('active'), false)
    assert.equal(isTerminal('deferred'), false)
    assert.equal(isTerminal('completed'), true)
    assert.equal(isTerminal('dropped'), true)
  })
})

describe('addProject', () => {
  it('inserts a project at status=active with closed=null', () => {
    const { store, entity } = addProject(EMPTY_STORE, {
      id: 'X1',
      created_at: T0,
      title: 'New',
      note: 'hi',
    })
    assert.equal(entity.type, 'project')
    assert.equal(entity.title, 'New')
    assert.equal(entity.note, 'hi')
    assert.equal(entity.status, 'active')
    assert.equal(entity.closed_at, null)
    assert.equal(entity.created_at, T0)
    assert.equal(store.lists.length, 1)
  })

  it('rejects empty title', () => {
    assert.throws(
      () => addProject(EMPTY_STORE, { id: 'X1', created_at: T0, title: '   ' }),
      InvalidArgument,
    )
  })
})

describe('addAction', () => {
  it('creates an active action with parent project', () => {
    let s: Store = EMPTY_STORE
    s = addProject(s, { id: 'P1', created_at: T0, title: 'P' }).store
    const { entity } = addAction(s, {
      id: 'A1',
      created_at: T0,
      title: 'Do thing',
      status: 'active',
      project: 'P1',
      due: '2026-05-01',
    })
    assert.equal(entity.type, 'action')
    assert.equal(entity.project, 'P1')
    assert.equal(entity.status, 'active')
    assert.equal(entity.due, '2026-05-01')
    assert.equal(entity.start_at, null)
    assert.equal(entity.closed_at, null)
  })

  it('creates a deferred standalone action', () => {
    const { entity } = addAction(EMPTY_STORE, {
      id: 'A1',
      created_at: T0,
      title: 'Someday',
      status: 'deferred',
    })
    assert.equal(entity.project, null)
    assert.equal(entity.status, 'deferred')
    assert.equal(entity.start_at, null)
  })

  it('creates a deferred action with start_at', () => {
    const { entity } = addAction(EMPTY_STORE, {
      id: 'A1',
      created_at: T0,
      title: 'Schedule',
      status: 'deferred',
      start_at: FUTURE,
    })
    assert.equal(entity.status, 'deferred')
    assert.equal(entity.start_at, FUTURE)
  })

  it('ignores start_at when status=active', () => {
    const { entity } = addAction(EMPTY_STORE, {
      id: 'A1',
      created_at: T0,
      title: 'Active',
      status: 'active',
      start_at: FUTURE,
    })
    assert.equal(entity.status, 'active')
    assert.equal(entity.start_at, null)
  })

  it('rejects unknown parent project', () => {
    assert.throws(
      () =>
        addAction(EMPTY_STORE, {
          id: 'A1',
          created_at: T0,
          title: 'x',
          status: 'active',
          project: 'NOPE',
        }),
      InvalidArgument,
    )
  })
})

describe('addWaiting', () => {
  it('creates a waiting item at status=active', () => {
    const { entity } = addWaiting(EMPTY_STORE, {
      id: 'W1',
      created_at: T0,
      title: 'Waiting',
    })
    assert.equal(entity.type, 'waiting')
    assert.equal(entity.status, 'active')
    assert.equal(entity.closed_at, null)
  })
})

describe('findEntity', () => {
  it('looks up across lists and items', () => {
    const s = seed()
    assert.equal(findList(s, 'P1')?.id, 'P1')
    assert.equal(findItem(s, 'A1')?.id, 'A1')
    assert.equal(findEntity(s, 'P1')?.id, 'P1')
    assert.equal(findEntity(s, 'W1')?.id, 'W1')
    assert.equal(findEntity(s, 'NOPE'), undefined)
  })
})

describe('editList', () => {
  it('updates title and note', () => {
    let s = seed()
    const { store, entity } = editList(s, 'P1', { title: 'Renamed', note: 'new note' })
    s = store
    assert.equal(entity.title, 'Renamed')
    assert.equal(entity.note, 'new note')
    assert.equal(findList(s, 'P1')?.title, 'Renamed')
  })

  it('clears note with null', () => {
    const s = seed()
    const { entity } = editList(s, 'P1', { note: null })
    assert.equal(entity.note, null)
  })

  it('throws NothingToEdit when patch is empty', () => {
    assert.throws(() => editList(seed(), 'P1', {}), NothingToEdit)
  })

  it('throws on unknown id', () => {
    assert.throws(() => editList(seed(), 'NOPE', { title: 'x' }), NotFound)
  })

  it('rejects empty title', () => {
    assert.throws(() => editList(seed(), 'P1', { title: '  ' }), InvalidArgument)
  })
})

describe('editItem', () => {
  it('updates action fields', () => {
    let s = seed()
    const { store, entity } = editItem(s, 'A1', {
      title: 'A1 renamed',
      due: '2026-06-01',
      project: null,
    })
    s = store
    assert.equal(entity.type, 'action')
    assert.equal(entity.title, 'A1 renamed')
    assert.equal((entity as ActionItem).due, '2026-06-01')
    assert.equal(entity.project, null)
  })

  it('rejects --due on waiting items', () => {
    assert.throws(() => editItem(seed(), 'W1', { due: '2026-05-01' }), InvalidArgument)
  })

  it('rejects start_at on waiting items', () => {
    assert.throws(() => editItem(seed(), 'W1', { start_at: FUTURE }), InvalidArgument)
  })

  it('clears start_at on actions with null', () => {
    let s = seed()
    s = setStatus(s, 'A2', { status: 'deferred', start_at: FUTURE }).store
    const { entity } = editItem(s, 'A2', { start_at: null })
    assert.equal((entity as ActionItem).start_at, null)
  })

  it('clears due on actions with null', () => {
    let s = seed()
    s = editItem(s, 'A1', { due: '2026-05-01' }).store
    const { entity } = editItem(s, 'A1', { due: null })
    assert.equal((entity as ActionItem).due, null)
  })

  it('rejects unknown new parent project', () => {
    assert.throws(() => editItem(seed(), 'A1', { project: 'NOPE' }), InvalidArgument)
  })

  it('throws NothingToEdit when no fields', () => {
    assert.throws(() => editItem(seed(), 'A1', {}), NothingToEdit)
  })
})

describe('setStatus', () => {
  it('activates a completed action and clears closed_at and start_at', () => {
    let s = seed()
    s = setStatus(s, 'A2', { status: 'deferred', start_at: FUTURE }).store
    s = setStatus(s, 'A2', { status: 'completed', closed_at: T0 }).store
    const { entity } = setStatus(s, 'A2', { status: 'active' })
    assert.equal((entity as ActionItem).status, 'active')
    assert.equal((entity as ActionItem).closed_at, null)
    assert.equal((entity as ActionItem).start_at, null)
  })

  it('defers an action with start_at', () => {
    const { entity } = setStatus(seed(), 'A1', { status: 'deferred', start_at: FUTURE })
    assert.equal((entity as ActionItem).status, 'deferred')
    assert.equal((entity as ActionItem).start_at, FUTURE)
    assert.equal((entity as ActionItem).closed_at, null)
  })

  it('defers an action without start_at clears any prior start_at', () => {
    let s = seed()
    s = setStatus(s, 'A1', { status: 'deferred', start_at: FUTURE }).store
    const { entity } = setStatus(s, 'A1', { status: 'deferred', start_at: null })
    assert.equal((entity as ActionItem).start_at, null)
    assert.equal((entity as ActionItem).status, 'deferred')
  })

  it('completing an action clears start_at', () => {
    let s = seed()
    s = setStatus(s, 'A1', { status: 'deferred', start_at: FUTURE }).store
    const { entity } = setStatus(s, 'A1', { status: 'completed', closed_at: T0 })
    assert.equal((entity as ActionItem).status, 'completed')
    assert.equal((entity as ActionItem).start_at, null)
    assert.equal((entity as ActionItem).closed_at, T0)
  })

  it('defers a project that was dropped', () => {
    let s = seed()
    s = setStatus(s, 'P1', { status: 'dropped', closed_at: T0 }).store
    const { entity } = setStatus(s, 'P1', { status: 'deferred', start_at: null })
    assert.equal((entity as ProjectList).status, 'deferred')
    assert.equal((entity as ProjectList).closed_at, null)
  })

  it('rejects activate and defer on waiting items', () => {
    assert.throws(() => setStatus(seed(), 'W1', { status: 'active' }), InvalidArgument)
    assert.throws(
      () => setStatus(seed(), 'W1', { status: 'deferred', start_at: null }),
      InvalidArgument,
    )
  })

  it('completes a waiting item', () => {
    const { entity } = setStatus(seed(), 'W1', { status: 'completed', closed_at: T0 })
    assert.equal((entity as WaitingItem).status, 'completed')
    assert.equal((entity as WaitingItem).closed_at, T0)
  })

  it('drops a project', () => {
    const { entity } = setStatus(seed(), 'P1', { status: 'dropped', closed_at: T0 })
    assert.equal((entity as ProjectList).status, 'dropped')
    assert.equal((entity as ProjectList).closed_at, T0)
  })

  it('completed and dropped are mutually exclusive (closed reflects last write)', () => {
    let s = seed()
    s = setStatus(s, 'A1', { status: 'completed', closed_at: T0 }).store
    let entity = findItem(s, 'A1') as ActionItem
    assert.equal(entity.status, 'completed')
    assert.equal(entity.closed_at, T0)

    s = setStatus(s, 'A1', { status: 'dropped', closed_at: '2026-04-28T00:00:00Z' }).store
    entity = findItem(s, 'A1') as ActionItem
    assert.equal(entity.status, 'dropped')
    assert.equal(entity.closed_at, '2026-04-28T00:00:00Z')
  })
})

describe('bucket helpers', () => {
  it('liveActions filters by status=active and parent active', () => {
    const s = seed()
    const ids = liveActions(s, TODAY).map((a) => a.id).sort()
    assert.deepEqual(ids, ['A1', 'A3'])
  })

  it('deferredActions includes open-ended (start_at=null) deferred actions', () => {
    const s = seed()
    const ids = deferredActions(s, TODAY).map((a) => a.id)
    assert.deepEqual(ids, ['A2'])
  })

  it('deferredActions includes future-start (scheduled) actions', () => {
    let s = seed()
    s = setStatus(s, 'A2', { status: 'deferred', start_at: FUTURE }).store
    assert.deepEqual(deferredActions(s, TODAY).map((a) => a.id), ['A2'])
  })

  it('past-due scheduled action is promoted into liveActions and excluded from deferredActions', () => {
    let s = seed()
    s = setStatus(s, 'A2', { status: 'deferred', start_at: PAST }).store
    const liveIds = liveActions(s, TODAY).map((a) => a.id).sort()
    assert.deepEqual(liveIds, ['A1', 'A2', 'A3'])
    assert.deepEqual(deferredActions(s, TODAY), [])
  })

  it('start_at equal to today counts as past-due (promoted into liveActions)', () => {
    let s = seed()
    s = setStatus(s, 'A2', { status: 'deferred', start_at: TODAY }).store
    assert.deepEqual(liveActions(s, TODAY).map((a) => a.id).sort(), ['A1', 'A2', 'A3'])
    assert.deepEqual(deferredActions(s, TODAY), [])
  })

  it('liveWaiting filters waiting items only', () => {
    const ids = liveWaiting(seed()).map((w) => w.id)
    assert.deepEqual(ids, ['W1'])
  })

  it('hides children of a deferred parent project from liveActions and deferredActions', () => {
    let s = seed()
    s = setStatus(s, 'A2', { status: 'deferred', start_at: FUTURE }).store
    s = setStatus(s, 'P1', { status: 'deferred', start_at: null }).store
    assert.deepEqual(liveActions(s, TODAY).map((a) => a.id), ['A3'])
    assert.deepEqual(deferredActions(s, TODAY), [])
  })

  it('hides children of a deferred parent project from liveWaiting', () => {
    let s = seed()
    s = setStatus(s, 'P1', { status: 'deferred', start_at: null }).store
    assert.deepEqual(liveWaiting(s), [])
  })

  it('hides children of a completed parent project too', () => {
    let s = seed()
    s = setStatus(s, 'P1', { status: 'completed', closed_at: T0 }).store
    const ids = liveActions(s, TODAY).map((a) => a.id)
    assert.deepEqual(ids, ['A3'])
  })

  it('excludes terminal items from active buckets', () => {
    let s = seed()
    s = setStatus(s, 'A1', { status: 'completed', closed_at: T0 }).store
    const ids = liveActions(s, TODAY).map((a) => a.id)
    assert.deepEqual(ids, ['A3'])
  })

  it('activeProjects/deferredProjects exclude terminal projects', () => {
    let s = seed()
    s = setStatus(s, 'P2', { status: 'deferred', start_at: null }).store
    s = setStatus(s, 'P1', { status: 'completed', closed_at: T0 }).store
    const active = activeProjects(s).map((p) => p.id)
    const def = deferredProjects(s).map((p) => p.id)
    assert.deepEqual(active, [])
    assert.deepEqual(def, ['P2'])
  })
})

describe('immutability', () => {
  it('mutators do not mutate the input store', () => {
    const s: Store = EMPTY_STORE
    const beforeLists = s.lists
    const beforeItems = s.items
    const { store } = addProject(s, { id: 'P', created_at: T0, title: 'X' })
    assert.notEqual(store.lists, beforeLists)
    assert.equal(s.lists, beforeLists)
    assert.equal(s.items, beforeItems)
  })

  it('setStatus returns a new items array', () => {
    let s = seed()
    const beforeItems = s.items
    s = setStatus(s, 'A1', { status: 'completed', closed_at: T0 }).store
    assert.notEqual(s.items, beforeItems)
  })
})

describe('resolveRef', () => {
  it('returns lists and items by id', () => {
    const s = seed()
    assert.equal(resolveRef(s, 'P1').id, 'P1')
    assert.equal(resolveRef(s, 'A1').id, 'A1')
    assert.equal(resolveRef(s, 'W1').id, 'W1')
  })

  it('throws NotFound on unknown id', () => {
    assert.throws(() => resolveRef(seed(), 'NOPE'), NotFound)
  })
})

// Deadlines ------------------------------------------------------------

function seedWithDeadlines(): Store {
  let s = seed()
  s = addDeadline(s, { id: 'D1', created_at: T0, title: 'Q3 launch', date: FUTURE, project: 'P1' }).store
  s = addDeadline(s, { id: 'D2', created_at: T0, title: 'standalone', date: FUTURE, project: null }).store
  return s
}

describe('addDeadline', () => {
  it('creates an active deadline with project and note', () => {
    let s: Store = EMPTY_STORE
    s = addProject(s, { id: 'P1', created_at: T0, title: 'P' }).store
    const { entity } = addDeadline(s, {
      id: 'D1',
      created_at: T0,
      title: 'Q3 launch',
      date: FUTURE,
      project: 'P1',
      note: 'tracking',
    })
    assert.equal(entity.type, 'deadline')
    assert.equal(entity.title, 'Q3 launch')
    assert.equal(entity.date, FUTURE)
    assert.equal(entity.status, 'active')
    assert.equal(entity.closed_at, null)
    assert.equal(entity.project, 'P1')
    assert.equal(entity.note, 'tracking')
    assert.equal(entity.created_at, T0)
  })

  it('creates a standalone deadline', () => {
    const { entity } = addDeadline(EMPTY_STORE, {
      id: 'D1',
      created_at: T0,
      title: 'visa expires',
      date: FUTURE,
    })
    assert.equal(entity.project, null)
    assert.equal(entity.note, null)
  })

  it('rejects empty title', () => {
    assert.throws(
      () => addDeadline(EMPTY_STORE, { id: 'D1', created_at: T0, title: '   ', date: FUTURE }),
      InvalidArgument,
    )
  })

  it('rejects unknown parent project', () => {
    assert.throws(
      () =>
        addDeadline(EMPTY_STORE, {
          id: 'D1',
          created_at: T0,
          title: 'x',
          date: FUTURE,
          project: 'NOPE',
        }),
      InvalidArgument,
    )
  })
})

describe('setStatus on deadline', () => {
  it('drops a deadline (sets closed_at)', () => {
    const s = seedWithDeadlines()
    const { entity } = setStatus(s, 'D1', { status: 'dropped', closed_at: T0 })
    assert.equal((entity as DeadlineItem).type, 'deadline')
    assert.equal((entity as DeadlineItem).status, 'dropped')
    assert.equal((entity as DeadlineItem).closed_at, T0)
  })

  it('un-drops a deadline (active clears closed_at)', () => {
    let s = seedWithDeadlines()
    s = setStatus(s, 'D1', { status: 'dropped', closed_at: T0 }).store
    const { entity } = setStatus(s, 'D1', { status: 'active' })
    assert.equal((entity as DeadlineItem).status, 'active')
    assert.equal((entity as DeadlineItem).closed_at, null)
  })

  it('rejects complete on a deadline', () => {
    assert.throws(
      () => setStatus(seedWithDeadlines(), 'D1', { status: 'completed', closed_at: T0 }),
      (err: Error) =>
        err instanceof InvalidArgument && /cannot complete deadline D1/.test(err.message),
    )
  })

  it('rejects defer on a deadline', () => {
    assert.throws(
      () => setStatus(seedWithDeadlines(), 'D1', { status: 'deferred', start_at: null }),
      (err: Error) =>
        err instanceof InvalidArgument && /cannot defer deadline D1/.test(err.message),
    )
  })
})

describe('editItem on deadline', () => {
  it('updates title, note, project on a deadline', () => {
    let s = seedWithDeadlines()
    const { store, entity } = editItem(s, 'D1', { title: 'Q3 launch (renamed)', project: null, note: 'changed' })
    s = store
    assert.equal(entity.type, 'deadline')
    assert.equal(entity.title, 'Q3 launch (renamed)')
    assert.equal(entity.project, null)
    assert.equal(entity.note, 'changed')
  })

  it('updates date on a deadline', () => {
    const s = seedWithDeadlines()
    const { entity } = editItem(s, 'D1', { date: '2027-01-01' })
    assert.equal((entity as DeadlineItem).date, '2027-01-01')
  })

  it('rejects --due on a deadline', () => {
    assert.throws(
      () => editItem(seedWithDeadlines(), 'D1', { due: '2026-12-31' }),
      (err: Error) => err instanceof InvalidArgument && /--due.*not allowed.*deadline/i.test(err.message),
    )
  })

  it('rejects --date on an action', () => {
    assert.throws(
      () => editItem(seedWithDeadlines(), 'A1', { date: '2026-12-31' }),
      (err: Error) => err instanceof InvalidArgument && /--date.*not allowed.*action/i.test(err.message),
    )
  })

  it('rejects --date on a waiting item', () => {
    assert.throws(
      () => editItem(seedWithDeadlines(), 'W1', { date: '2026-12-31' }),
      (err: Error) => err instanceof InvalidArgument && /--date.*not allowed.*waiting/i.test(err.message),
    )
  })

  it('throws NothingToEdit on empty patch for deadline', () => {
    assert.throws(() => editItem(seedWithDeadlines(), 'D1', {}), NothingToEdit)
  })
})

describe('activeDeadlines', () => {
  it('includes status=active deadlines with date >= today and parent active', () => {
    const s = seedWithDeadlines()
    const ids = activeDeadlines(s, TODAY).map((d) => d.id).sort()
    assert.deepEqual(ids, ['D1', 'D2'])
  })

  it('includes a deadline whose date equals today', () => {
    let s: Store = EMPTY_STORE
    s = addDeadline(s, { id: 'DT', created_at: T0, title: 'today', date: TODAY }).store
    const ids = activeDeadlines(s, TODAY).map((d) => d.id)
    assert.deepEqual(ids, ['DT'])
  })

  it('excludes dropped deadlines', () => {
    let s = seedWithDeadlines()
    s = setStatus(s, 'D1', { status: 'dropped', closed_at: T0 }).store
    const ids = activeDeadlines(s, TODAY).map((d) => d.id)
    assert.deepEqual(ids, ['D2'])
  })

  it('excludes deadlines whose date is in the past', () => {
    let s: Store = EMPTY_STORE
    s = addDeadline(s, { id: 'PD', created_at: T0, title: 'past', date: PAST }).store
    const ids = activeDeadlines(s, TODAY).map((d) => d.id)
    assert.deepEqual(ids, [])
  })

  it('excludes deadlines whose parent project is deferred', () => {
    let s = seedWithDeadlines()
    s = setStatus(s, 'P1', { status: 'deferred', start_at: null }).store
    const ids = activeDeadlines(s, TODAY).map((d) => d.id)
    assert.deepEqual(ids, ['D2'])
  })

  it('excludes deadlines whose parent project is terminal', () => {
    let s = seedWithDeadlines()
    s = setStatus(s, 'P1', { status: 'completed', closed_at: T0 }).store
    const ids = activeDeadlines(s, TODAY).map((d) => d.id)
    assert.deepEqual(ids, ['D2'])
  })
})

describe('liveActions / liveWaiting do not surface deadlines', () => {
  it('liveActions excludes deadline items', () => {
    const s = seedWithDeadlines()
    const types = new Set(liveActions(s).map((a) => a.type))
    assert.deepEqual([...types], ['action'])
  })

  it('liveWaiting excludes deadline items', () => {
    const s = seedWithDeadlines()
    const types = new Set(liveWaiting(s).map((w) => w.type))
    assert.deepEqual([...types], ['waiting'])
  })
})

// appendNote ----------------------------------------------------------

describe('appendNote', () => {
  it('sets note when previously null on a project', () => {
    let s: Store = EMPTY_STORE
    s = addProject(s, { id: 'P1', created_at: T0, title: 'P' }).store
    const { entity } = appendNote(s, 'P1', 'first fact')
    assert.equal((entity as ProjectList).note, 'first fact')
  })

  it('joins with a blank line when note already exists on a project', () => {
    let s: Store = EMPTY_STORE
    s = addProject(s, { id: 'P1', created_at: T0, title: 'P', note: 'existing' }).store
    const { entity } = appendNote(s, 'P1', 'second fact')
    assert.equal((entity as ProjectList).note, 'existing\n\nsecond fact')
  })

  it('joins multiple appends in order', () => {
    let s: Store = EMPTY_STORE
    s = addProject(s, { id: 'P1', created_at: T0, title: 'P' }).store
    s = appendNote(s, 'P1', 'one').store
    s = appendNote(s, 'P1', 'two').store
    s = appendNote(s, 'P1', 'three').store
    assert.equal((findList(s, 'P1') as ProjectList).note, 'one\n\ntwo\n\nthree')
  })

  it('works on actions', () => {
    let s: Store = EMPTY_STORE
    s = addAction(s, { id: 'A1', created_at: T0, title: 'A', status: 'active' }).store
    const r1 = appendNote(s, 'A1', 'fact 1')
    assert.equal((r1.entity as ActionItem).note, 'fact 1')
    const r2 = appendNote(r1.store, 'A1', 'fact 2')
    assert.equal((r2.entity as ActionItem).note, 'fact 1\n\nfact 2')
  })

  it('works on waiting items', () => {
    let s: Store = EMPTY_STORE
    s = addWaiting(s, { id: 'W1', created_at: T0, title: 'W' }).store
    const { entity } = appendNote(s, 'W1', 'follow-up sent')
    assert.equal((entity as WaitingItem).note, 'follow-up sent')
  })

  it('works on deadlines', () => {
    let s: Store = EMPTY_STORE
    s = addDeadline(s, { id: 'D1', created_at: T0, title: 'Q3', date: FUTURE }).store
    const { entity } = appendNote(s, 'D1', 'fixed in stone')
    assert.equal((entity as DeadlineItem).note, 'fixed in stone')
  })

  it('rejects empty body', () => {
    let s: Store = EMPTY_STORE
    s = addProject(s, { id: 'P1', created_at: T0, title: 'P' }).store
    assert.throws(() => appendNote(s, 'P1', ''), InvalidArgument)
    assert.throws(() => appendNote(s, 'P1', '   '), InvalidArgument)
  })

  it('throws NotFound on unknown id', () => {
    assert.throws(() => appendNote(EMPTY_STORE, 'NOPE', 'x'), NotFound)
  })

  it('does not mutate the input store', () => {
    let s: Store = EMPTY_STORE
    s = addProject(s, { id: 'P1', created_at: T0, title: 'P', note: 'a' }).store
    const beforeLists = s.lists
    appendNote(s, 'P1', 'b')
    assert.equal(s.lists, beforeLists)
    assert.equal((findList(s, 'P1') as ProjectList).note, 'a')
  })
})

// Sub-projects -------------------------------------------------------

describe('sub-projects', () => {
  function withRoot(): Store {
    return addProject(EMPTY_STORE, { id: 'R', created_at: T0, title: 'Root' }).store
  }

  it('addProject defaults parent to null', () => {
    const { entity } = addProject(EMPTY_STORE, { id: 'P', created_at: T0, title: 'P' })
    assert.equal(entity.parent, null)
  })

  it('addProject with valid root parent stores the parent id', () => {
    const s = withRoot()
    const { entity } = addProject(s, { id: 'C', created_at: T0, title: 'Child', parent: 'R' })
    assert.equal(entity.parent, 'R')
  })

  it('addProject rejects unknown parent', () => {
    assert.throws(
      () => addProject(EMPTY_STORE, { id: 'C', created_at: T0, title: 'Child', parent: 'NOPE' }),
      InvalidArgument,
    )
  })

  it('addProject rejects parent that itself has a parent (depth-1 limit)', () => {
    let s = withRoot()
    s = addProject(s, { id: 'C', created_at: T0, title: 'Child', parent: 'R' }).store
    assert.throws(
      () => addProject(s, { id: 'GC', created_at: T0, title: 'Grandchild', parent: 'C' }),
      (err: Error) =>
        err instanceof InvalidArgument && /must be a root project/i.test(err.message),
    )
  })

  it('addProject rejects parent that resolves to a non-project entity', () => {
    let s: Store = EMPTY_STORE
    s = addAction(s, { id: 'A', created_at: T0, title: 'a', status: 'active' }).store
    assert.throws(
      () => addProject(s, { id: 'P', created_at: T0, title: 'P', parent: 'A' }),
      InvalidArgument,
    )
  })

  it('editList sets a parent on a previously root project', () => {
    let s = withRoot()
    s = addProject(s, { id: 'C', created_at: T0, title: 'Child' }).store
    const { entity } = editList(s, 'C', { parent: 'R' })
    assert.equal(entity.parent, 'R')
  })

  it('editList clears parent with null', () => {
    let s = withRoot()
    s = addProject(s, { id: 'C', created_at: T0, title: 'Child', parent: 'R' }).store
    const { entity } = editList(s, 'C', { parent: null })
    assert.equal(entity.parent, null)
  })

  it('editList rejects making a project with children into a child', () => {
    let s = withRoot()
    s = addProject(s, { id: 'P2', created_at: T0, title: 'OtherRoot' }).store
    s = addProject(s, { id: 'C', created_at: T0, title: 'Child', parent: 'R' }).store
    // R has a child; cannot now reparent R under P2.
    assert.throws(
      () => editList(s, 'R', { parent: 'P2' }),
      (err: Error) =>
        err instanceof InvalidArgument && /has children/i.test(err.message),
    )
  })

  it('editList rejects parent that itself has a parent', () => {
    let s = withRoot()
    s = addProject(s, { id: 'C', created_at: T0, title: 'Child', parent: 'R' }).store
    s = addProject(s, { id: 'P3', created_at: T0, title: 'Standalone' }).store
    assert.throws(
      () => editList(s, 'P3', { parent: 'C' }),
      (err: Error) =>
        err instanceof InvalidArgument && /must be a root/i.test(err.message),
    )
  })

  it('findChildren returns direct children only', () => {
    let s = withRoot()
    s = addProject(s, { id: 'C1', created_at: T0, title: 'C1', parent: 'R' }).store
    s = addProject(s, { id: 'C2', created_at: T0, title: 'C2', parent: 'R' }).store
    s = addProject(s, { id: 'P3', created_at: T0, title: 'Standalone' }).store
    const ids = findChildren(s, 'R').map((p) => p.id).sort()
    assert.deepEqual(ids, ['C1', 'C2'])
    assert.deepEqual(findChildren(s, 'P3'), [])
  })

  it('activeProjects excludes a child whose parent is deferred', () => {
    let s = withRoot()
    s = addProject(s, { id: 'C', created_at: T0, title: 'Child', parent: 'R' }).store
    assert.deepEqual(activeProjects(s).map((p) => p.id).sort(), ['C', 'R'])
    s = setStatus(s, 'R', { status: 'deferred', start_at: null }).store
    assert.deepEqual(activeProjects(s).map((p) => p.id), [])
  })

  it('cascades through one hop: items under a child of a deferred parent are not live', () => {
    let s = withRoot()
    s = addProject(s, { id: 'C', created_at: T0, title: 'Child', parent: 'R' }).store
    s = addAction(s, { id: 'A', created_at: T0, title: 'A', status: 'active', project: 'C' }).store
    s = addWaiting(s, { id: 'W', created_at: T0, title: 'W', project: 'C' }).store
    assert.deepEqual(liveActions(s, TODAY).map((a) => a.id), ['A'])
    assert.deepEqual(liveWaiting(s).map((w) => w.id), ['W'])

    s = setStatus(s, 'R', { status: 'deferred', start_at: null }).store
    assert.deepEqual(liveActions(s, TODAY), [])
    assert.deepEqual(liveWaiting(s), [])
  })

  it('cascade also applies to deadlines', () => {
    let s = withRoot()
    s = addProject(s, { id: 'C', created_at: T0, title: 'Child', parent: 'R' }).store
    s = addDeadline(s, { id: 'D', created_at: T0, title: 'D', date: FUTURE, project: 'C' }).store
    assert.deepEqual(activeDeadlines(s, TODAY).map((d) => d.id), ['D'])
    s = setStatus(s, 'R', { status: 'deferred', start_at: null }).store
    assert.deepEqual(activeDeadlines(s, TODAY), [])
  })

  it('a dropped parent suppresses the child too', () => {
    let s = withRoot()
    s = addProject(s, { id: 'C', created_at: T0, title: 'Child', parent: 'R' }).store
    s = setStatus(s, 'R', { status: 'dropped', closed_at: T0 }).store
    assert.deepEqual(activeProjects(s).map((p) => p.id), [])
  })
})
