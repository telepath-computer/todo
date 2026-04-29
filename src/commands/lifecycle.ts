import { resolveDataDir } from '../core/config.js'
import { requireFutureDate } from '../core/dates.js'
import { InvalidArgument, NotFound } from '../core/errors.js'
import { deleteMemo, findEntity, setStatus, type Item, type List } from '../core/model.js'
import { nowIso, readStore, writeStore } from '../core/store.js'
import { json } from './shared.js'

function persist(fn: (dataDir: string) => { store: Parameters<typeof writeStore>[1]; entity: List | Item }): string {
  const { dataDir } = resolveDataDir()
  const { store: next, entity } = fn(dataDir)
  writeStore(dataDir, next)
  return json(entity)
}

export function activateCmd(id: string): string {
  return persist((dataDir) => setStatus(readStore(dataDir), id, { status: 'active' }))
}

export function deferCmd(id: string, opts: { start?: string } = {}): string {
  return persist((dataDir) => {
    const store = readStore(dataDir)
    if (opts.start !== undefined) {
      const e = findEntity(store, id)
      if (!e) throw new NotFound(`not found: ${id}`)
      if (e.type === 'memo') throw new InvalidArgument(`${id} is a memo and has no status`)
      if (e.type === 'project') throw new InvalidArgument('--start is not allowed on projects')
      if (e.type === 'waiting') throw new InvalidArgument('--start is not allowed on waiting items')
      if (opts.start === '') throw new InvalidArgument('--start cannot be empty on defer')
    }
    const start_at = opts.start === undefined ? null : requireFutureDate(opts.start)
    return setStatus(store, id, { status: 'deferred', start_at })
  })
}

export function completeCmd(id: string): string {
  return persist((dataDir) => setStatus(readStore(dataDir), id, { status: 'completed', closed_at: nowIso() }))
}

export function dropCmd(id: string): string {
  const { dataDir } = resolveDataDir()
  const store = readStore(dataDir)
  const entity = findEntity(store, id)
  if (!entity) throw new NotFound(`not found: ${id}`)
  if (entity.type === 'memo') {
    writeStore(dataDir, deleteMemo(store, id))
    return json(entity)
  }
  const { store: next, entity: updated } = setStatus(store, id, { status: 'dropped', closed_at: nowIso() })
  writeStore(dataDir, next)
  return json(updated)
}
