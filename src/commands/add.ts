import { resolveDataDir } from '../core/config.js'
import { resolveDueInput } from '../core/dates.js'
import { InvalidArgument } from '../core/errors.js'
import { addAction, addWaiting } from '../core/model.js'
import { newId, nowIso, readStore, writeStore } from '../core/store.js'
import { json } from './shared.js'

export type AddCmdOpts = {
  title: string
  active?: boolean
  deferred?: boolean
  waiting?: boolean
  project?: string
  due?: string
  note?: string
}

export function addCmd(opts: AddCmdOpts): string {
  const modes = [opts.active, opts.deferred, opts.waiting].filter(Boolean).length
  if (modes === 0) {
    throw new InvalidArgument('--active, --deferred, or --waiting is required')
  }
  if (modes > 1) {
    throw new InvalidArgument(
      `--active, --deferred, --waiting are mutually exclusive (got ${modes})`,
    )
  }
  if (opts.waiting && opts.due !== undefined) {
    throw new InvalidArgument('--due is not allowed on waiting items')
  }

  const { dataDir } = resolveDataDir()
  const store = readStore(dataDir)
  const id = newId()
  const created = nowIso()
  const list = opts.project ?? null

  if (opts.waiting) {
    const { store: next, entity } = addWaiting(store, {
      id,
      created,
      title: opts.title,
      list,
      note: opts.note ?? null,
    })
    writeStore(dataDir, next)
    return json(entity)
  }

  const due = opts.due !== undefined ? resolveDueInput(opts.due) : null
  const { store: next, entity } = addAction(store, {
    id,
    created,
    title: opts.title,
    active: !!opts.active,
    list,
    due,
    note: opts.note ?? null,
  })
  writeStore(dataDir, next)
  return json(entity)
}
