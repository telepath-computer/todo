import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { InvalidArgument, NotFound, NothingToEdit } from '../src/core/errors.js'
import {
  EMPTY_STORE,
  activeProjects,
  addAction,
  addProject,
  addWaiting,
  deferredActions,
  deferredProjects,
  editItem,
  editList,
  findEntity,
  findItem,
  findList,
  isTerminal,
  liveActions,
  liveWaiting,
  resolveRef,
  setStatus,
  type ActionItem,
  type ProjectList,
  type Store,
  type WaitingItem,
} from '../src/core/model.js'

const T0 = '2026-04-27T10:00:00Z'

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
  it('activates a completed action and clears closed', () => {
    let s = seed()
    s = setStatus(s, 'A2', 'completed', T0).store
    const { entity } = setStatus(s, 'A2', 'active', null)
    assert.equal((entity as ActionItem).status, 'active')
    assert.equal((entity as ActionItem).closed_at, null)
  })

  it('defers a project that was dropped', () => {
    let s = seed()
    s = setStatus(s, 'P1', 'dropped', T0).store
    const { entity } = setStatus(s, 'P1', 'deferred', null)
    assert.equal((entity as ProjectList).status, 'deferred')
    assert.equal((entity as ProjectList).closed_at, null)
  })

  it('rejects activate and defer on waiting items', () => {
    assert.throws(() => setStatus(seed(), 'W1', 'active', null), InvalidArgument)
    assert.throws(() => setStatus(seed(), 'W1', 'deferred', null), InvalidArgument)
  })

  it('completes a waiting item', () => {
    const { entity } = setStatus(seed(), 'W1', 'completed', T0)
    assert.equal((entity as WaitingItem).status, 'completed')
    assert.equal((entity as WaitingItem).closed_at, T0)
  })

  it('drops a project', () => {
    const { entity } = setStatus(seed(), 'P1', 'dropped', T0)
    assert.equal((entity as ProjectList).status, 'dropped')
    assert.equal((entity as ProjectList).closed_at, T0)
  })

  it('rejects active/deferred with a timestamp', () => {
    assert.throws(() => setStatus(seed(), 'A1', 'active', T0), InvalidArgument)
    assert.throws(() => setStatus(seed(), 'A1', 'deferred', T0), InvalidArgument)
  })

  it('rejects completed/dropped without a timestamp', () => {
    assert.throws(() => setStatus(seed(), 'A1', 'completed', null), InvalidArgument)
    assert.throws(() => setStatus(seed(), 'A1', 'dropped', null), InvalidArgument)
  })

  it('completed and dropped are mutually exclusive (closed reflects last write)', () => {
    let s = seed()
    s = setStatus(s, 'A1', 'completed', T0).store
    let entity = findItem(s, 'A1') as ActionItem
    assert.equal(entity.status, 'completed')
    assert.equal(entity.closed_at, T0)

    s = setStatus(s, 'A1', 'dropped', '2026-04-28T00:00:00Z').store
    entity = findItem(s, 'A1') as ActionItem
    assert.equal(entity.status, 'dropped')
    assert.equal(entity.closed_at, '2026-04-28T00:00:00Z')
  })
})

describe('bucket helpers', () => {
  it('liveActions filters by status=active and parent active', () => {
    const s = seed()
    const ids = liveActions(s).map((a) => a.id).sort()
    assert.deepEqual(ids, ['A1', 'A3'])
  })

  it('deferredActions filters by status=deferred and parent active', () => {
    const s = seed()
    const ids = deferredActions(s).map((a) => a.id)
    assert.deepEqual(ids, ['A2'])
  })

  it('liveWaiting filters waiting items only', () => {
    const ids = liveWaiting(seed()).map((w) => w.id)
    assert.deepEqual(ids, ['W1'])
  })

  it('hides children of a deferred parent project from liveActions', () => {
    let s = seed()
    s = setStatus(s, 'P1', 'deferred', null).store
    const ids = liveActions(s).map((a) => a.id)
    assert.deepEqual(ids, ['A3'])
  })

  it('hides children of a deferred parent project from liveWaiting', () => {
    let s = seed()
    s = setStatus(s, 'P1', 'deferred', null).store
    assert.deepEqual(liveWaiting(s), [])
  })

  it('hides children of a completed parent project too', () => {
    let s = seed()
    s = setStatus(s, 'P1', 'completed', T0).store
    const ids = liveActions(s).map((a) => a.id)
    assert.deepEqual(ids, ['A3'])
  })

  it('excludes terminal items from active buckets', () => {
    let s = seed()
    s = setStatus(s, 'A1', 'completed', T0).store
    const ids = liveActions(s).map((a) => a.id)
    assert.deepEqual(ids, ['A3'])
  })

  it('activeProjects/deferredProjects exclude terminal projects', () => {
    let s = seed()
    s = setStatus(s, 'P2', 'deferred', null).store
    s = setStatus(s, 'P1', 'completed', T0).store
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
    s = setStatus(s, 'A1', 'completed', T0).store
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
