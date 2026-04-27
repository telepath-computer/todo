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
  liveActions,
  liveWaiting,
  resolveRef,
  setActive,
  setCompleted,
  setDropped,
  type ActionItem,
  type ProjectList,
  type Store,
  type WaitingItem,
} from '../src/core/model.js'

const T0 = '2026-04-27T10:00:00Z'

function seed(): Store {
  let s: Store = EMPTY_STORE
  s = addProject(s, { id: 'P1', created: T0, title: 'Proj A' }).store
  s = addProject(s, { id: 'P2', created: T0, title: 'Proj B' }).store
  s = addAction(s, { id: 'A1', created: T0, title: 'A1 task', active: true, list: 'P1' }).store
  s = addAction(s, { id: 'A2', created: T0, title: 'A2 task', active: false, list: 'P1' }).store
  s = addAction(s, { id: 'A3', created: T0, title: 'standalone', active: true, list: null }).store
  s = addWaiting(s, { id: 'W1', created: T0, title: 'cover art', list: 'P1' }).store
  return s
}

describe('addProject', () => {
  it('inserts a project with active=true and null terminals', () => {
    const { store, entity } = addProject(EMPTY_STORE, {
      id: 'X1',
      created: T0,
      title: 'New',
      note: 'hi',
    })
    assert.equal(entity.type, 'project')
    assert.equal(entity.title, 'New')
    assert.equal(entity.note, 'hi')
    assert.equal(entity.active, true)
    assert.equal(entity.completed, null)
    assert.equal(entity.dropped, null)
    assert.equal(entity.created, T0)
    assert.equal(store.lists.length, 1)
  })

  it('rejects empty title', () => {
    assert.throws(
      () => addProject(EMPTY_STORE, { id: 'X1', created: T0, title: '   ' }),
      InvalidArgument,
    )
  })
})

describe('addAction', () => {
  it('creates an active action with parent project', () => {
    let s: Store = EMPTY_STORE
    s = addProject(s, { id: 'P1', created: T0, title: 'P' }).store
    const { entity } = addAction(s, {
      id: 'A1',
      created: T0,
      title: 'Do thing',
      active: true,
      list: 'P1',
      due: '2026-05-01',
    })
    assert.equal(entity.type, 'action')
    assert.equal(entity.list, 'P1')
    assert.equal(entity.active, true)
    assert.equal(entity.due, '2026-05-01')
    assert.equal(entity.completed, null)
    assert.equal(entity.dropped, null)
  })

  it('creates a deferred standalone action', () => {
    const { entity } = addAction(EMPTY_STORE, {
      id: 'A1',
      created: T0,
      title: 'Someday',
      active: false,
    })
    assert.equal(entity.list, null)
    assert.equal(entity.active, false)
  })

  it('rejects unknown parent project', () => {
    assert.throws(
      () =>
        addAction(EMPTY_STORE, {
          id: 'A1',
          created: T0,
          title: 'x',
          active: true,
          list: 'NOPE',
        }),
      InvalidArgument,
    )
  })
})

describe('addWaiting', () => {
  it('creates a waiting item without active flag', () => {
    const { entity } = addWaiting(EMPTY_STORE, {
      id: 'W1',
      created: T0,
      title: 'Waiting',
    })
    assert.equal(entity.type, 'waiting')
    assert.equal((entity as Record<string, unknown>).active, undefined)
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
      list: null,
    })
    s = store
    assert.equal(entity.type, 'action')
    assert.equal(entity.title, 'A1 renamed')
    assert.equal((entity as ActionItem).due, '2026-06-01')
    assert.equal(entity.list, null)
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
    assert.throws(() => editItem(seed(), 'A1', { list: 'NOPE' }), InvalidArgument)
  })

  it('throws NothingToEdit when no fields', () => {
    assert.throws(() => editItem(seed(), 'A1', {}), NothingToEdit)
  })
})

describe('setActive', () => {
  it('activates a deferred action and clears terminal', () => {
    let s = seed()
    s = setCompleted(s, 'A2', T0).store
    const { entity } = setActive(s, 'A2', true)
    assert.equal((entity as ActionItem).active, true)
    assert.equal((entity as ActionItem).completed, null)
    assert.equal((entity as ActionItem).dropped, null)
  })

  it('defers a project and clears terminal', () => {
    let s = seed()
    s = setDropped(s, 'P1', T0).store
    const { entity } = setActive(s, 'P1', false)
    assert.equal((entity as ProjectList).active, false)
    assert.equal((entity as ProjectList).dropped, null)
  })

  it('rejects on waiting items', () => {
    assert.throws(() => setActive(seed(), 'W1', true), InvalidArgument)
    assert.throws(() => setActive(seed(), 'W1', false), InvalidArgument)
  })
})

describe('setCompleted / setDropped', () => {
  it('completed and dropped are mutually exclusive', () => {
    let s = seed()
    s = setCompleted(s, 'A1', T0).store
    let entity = findItem(s, 'A1') as ActionItem
    assert.equal(entity.completed, T0)
    assert.equal(entity.dropped, null)

    s = setDropped(s, 'A1', '2026-04-28T00:00:00Z').store
    entity = findItem(s, 'A1') as ActionItem
    assert.equal(entity.dropped, '2026-04-28T00:00:00Z')
    assert.equal(entity.completed, null)
  })

  it('works on waiting items', () => {
    const s = seed()
    const { entity } = setCompleted(s, 'W1', T0)
    assert.equal((entity as WaitingItem).completed, T0)
  })

  it('works on projects', () => {
    const { entity } = setDropped(seed(), 'P1', T0)
    assert.equal((entity as ProjectList).dropped, T0)
  })
})

describe('bucket helpers', () => {
  it('liveActions filters by active=true, !terminal, parent active', () => {
    const s = seed()
    const ids = liveActions(s).map((a) => a.id).sort()
    assert.deepEqual(ids, ['A1', 'A3'])
  })

  it('deferredActions filters by active=false, !terminal, parent active', () => {
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
    s = setActive(s, 'P1', false).store
    const ids = liveActions(s).map((a) => a.id)
    assert.deepEqual(ids, ['A3'])
  })

  it('hides children of a deferred parent project from liveWaiting', () => {
    let s = seed()
    s = setActive(s, 'P1', false).store
    assert.deepEqual(liveWaiting(s), [])
  })

  it('hides children of a completed parent project too', () => {
    let s = seed()
    s = setCompleted(s, 'P1', T0).store
    const ids = liveActions(s).map((a) => a.id)
    assert.deepEqual(ids, ['A3'])
  })

  it('excludes terminal items from active buckets', () => {
    let s = seed()
    s = setCompleted(s, 'A1', T0).store
    const ids = liveActions(s).map((a) => a.id)
    assert.deepEqual(ids, ['A3'])
  })

  it('activeProjects/deferredProjects exclude terminal projects', () => {
    let s = seed()
    s = setActive(s, 'P2', false).store
    s = setCompleted(s, 'P1', T0).store
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
    const { store } = addProject(s, { id: 'P', created: T0, title: 'X' })
    assert.notEqual(store.lists, beforeLists)
    assert.equal(s.lists, beforeLists)
    assert.equal(s.items, beforeItems)
  })

  it('replaceItem returns a new array', () => {
    let s = seed()
    const beforeItems = s.items
    s = setCompleted(s, 'A1', T0).store
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
