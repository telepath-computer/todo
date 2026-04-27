import { resolveDataDir } from '../core/config.js'
import { setStatus, type List, type Item } from '../core/model.js'
import { nowIso, readStore, writeStore } from '../core/store.js'
import { json } from './shared.js'

function persist(fn: (dataDir: string) => { store: Parameters<typeof writeStore>[1]; entity: List | Item }): string {
  const { dataDir } = resolveDataDir()
  const { store: next, entity } = fn(dataDir)
  writeStore(dataDir, next)
  return json(entity)
}

export function activateCmd(id: string): string {
  return persist((dataDir) => setStatus(readStore(dataDir), id, 'active', null))
}

export function deferCmd(id: string): string {
  return persist((dataDir) => setStatus(readStore(dataDir), id, 'deferred', null))
}

export function completeCmd(id: string): string {
  return persist((dataDir) => setStatus(readStore(dataDir), id, 'completed', nowIso()))
}

export function dropCmd(id: string): string {
  return persist((dataDir) => setStatus(readStore(dataDir), id, 'dropped', nowIso()))
}
