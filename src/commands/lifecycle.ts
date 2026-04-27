import { resolveDataDir } from '../core/config.js'
import { setActive, setCompleted, setDropped } from '../core/model.js'
import { nowIso, readStore, writeStore } from '../core/store.js'
import { json } from './shared.js'

function persist<T>(fn: (dataDir: string) => { store: Parameters<typeof writeStore>[1]; entity: T }): string {
  const { dataDir } = resolveDataDir()
  const { store: next, entity } = fn(dataDir)
  writeStore(dataDir, next)
  return json(entity)
}

export function activateCmd(id: string): string {
  return persist((dataDir) => setActive(readStore(dataDir), id, true))
}

export function deferCmd(id: string): string {
  return persist((dataDir) => setActive(readStore(dataDir), id, false))
}

export function completeCmd(id: string): string {
  return persist((dataDir) => setCompleted(readStore(dataDir), id, nowIso()))
}

export function dropCmd(id: string): string {
  return persist((dataDir) => setDropped(readStore(dataDir), id, nowIso()))
}
