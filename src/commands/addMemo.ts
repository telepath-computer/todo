import { resolveDataDir } from '../core/config.js'
import { addMemo } from '../core/model.js'
import { newId, nowIso, readStore, writeStore } from '../core/store.js'
import { json } from './shared.js'

export function addMemoCmd(opts: { note: string; pinned?: boolean; project?: string }): string {
  const { dataDir } = resolveDataDir()
  const store = readStore(dataDir)
  const { store: next, entity } = addMemo(store, {
    id: newId(),
    created_at: nowIso(),
    note: opts.note,
    pinned: opts.pinned ?? false,
    project: opts.project ?? null,
  })
  writeStore(dataDir, next)
  return json(entity)
}
