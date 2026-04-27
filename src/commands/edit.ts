import { resolveDataDir } from '../core/config.js'
import { resolveDueInput } from '../core/dates.js'
import { InvalidArgument } from '../core/errors.js'
import { editItem, editList, findEntity, type EditItemPatch, type EditListPatch } from '../core/model.js'
import { readStore, writeStore } from '../core/store.js'
import { NotFound } from '../core/errors.js'
import { json } from './shared.js'

export type EditCmdOpts = {
  title?: string
  note?: string
  due?: string
  project?: string
}

export function editCmd(id: string, opts: EditCmdOpts): string {
  const { dataDir } = resolveDataDir()
  const store = readStore(dataDir)
  const entity = findEntity(store, id)
  if (!entity) throw new NotFound(`not found: ${id}`)

  if (entity.type === 'project') {
    if (opts.due !== undefined) {
      throw new InvalidArgument('--due is not allowed on projects')
    }
    if (opts.project !== undefined) {
      throw new InvalidArgument('--project is not allowed on projects')
    }
    const patch: EditListPatch = {}
    if (opts.title !== undefined) patch.title = opts.title
    if (opts.note !== undefined) patch.note = opts.note === '' ? null : opts.note
    const { store: next, entity: out } = editList(store, id, patch)
    writeStore(dataDir, next)
    return json(out)
  }

  const patch: EditItemPatch = {}
  if (opts.title !== undefined) patch.title = opts.title
  if (opts.note !== undefined) patch.note = opts.note === '' ? null : opts.note
  if (opts.due !== undefined) patch.due = opts.due === '' ? null : resolveDueInput(opts.due)
  if (opts.project !== undefined) patch.project = opts.project === '' ? null : opts.project
  const { store: next, entity: out } = editItem(store, id, patch)
  writeStore(dataDir, next)
  return json(out)
}
