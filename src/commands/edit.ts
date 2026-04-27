import { resolveDataDir } from '../core/config.js'
import { resolveDueInput } from '../core/dates.js'
import { editItem } from '../core/model.js'
import { readStore, writeStore } from '../core/store.js'
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
  const patch: Parameters<typeof editItem>[2] = {}
  if (opts.title !== undefined) patch.title = opts.title
  if (opts.note !== undefined) patch.note = opts.note === '' ? null : opts.note
  if (opts.due !== undefined) patch.due = opts.due === '' ? null : resolveDueInput(opts.due)
  if (opts.project !== undefined) patch.list = opts.project === '' ? null : opts.project
  const { store: next, entity } = editItem(store, id, patch)
  writeStore(dataDir, next)
  return json(entity)
}
