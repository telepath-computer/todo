import { resolveDataDir } from '../core/config.js'
import { addProject, editList } from '../core/model.js'
import { newId, nowIso, readStore, writeStore } from '../core/store.js'
import { json } from './shared.js'

export type AddProjectOpts = { title: string; note?: string }



export function addProjectCmd(opts: AddProjectOpts): string {
  const { dataDir } = resolveDataDir()
  const store = readStore(dataDir)
  const { store: next, entity } = addProject(store, {
    id: newId(),
    created_at: nowIso(),
    title: opts.title,
    note: opts.note ?? null,
  })
  writeStore(dataDir, next)
  return json(entity)
}

export type EditProjectOpts = { title?: string; note?: string }

export function editProjectCmd(id: string, opts: EditProjectOpts): string {
  const { dataDir } = resolveDataDir()
  const store = readStore(dataDir)
  const patch: Parameters<typeof editList>[2] = {}
  if (opts.title !== undefined) patch.title = opts.title
  if (opts.note !== undefined) patch.note = opts.note === '' ? null : opts.note
  const { store: next, entity } = editList(store, id, patch)
  writeStore(dataDir, next)
  return json(entity)
}
