import { resolveDataDir } from '../core/config.js'
import { resolveDueInput } from '../core/dates.js'
import { InvalidArgument } from '../core/errors.js'
import { addMemo } from '../core/model.js'
import { newId, nowIso, readStore, writeStore } from '../core/store.js'
import { json } from './shared.js'

export function addMemoCmd(opts: { note: string; start?: string; project?: string }): string {
  if (opts.start === '') {
    throw new InvalidArgument('--start cannot be empty on add')
  }
  const { dataDir } = resolveDataDir()
  const store = readStore(dataDir)
  const { store: next, entity } = addMemo(store, {
    id: newId(),
    created_at: nowIso(),
    note: opts.note,
    start_at: opts.start !== undefined ? resolveDueInput(opts.start) : null,
    project: opts.project ?? null,
  })
  writeStore(dataDir, next)
  return json(entity)
}
