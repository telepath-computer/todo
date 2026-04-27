import { resolveDataDir } from '../core/config.js'
import { resolveDueInput } from '../core/dates.js'
import { InvalidArgument } from '../core/errors.js'
import { addAction, addProject, addWaiting } from '../core/model.js'
import { newId, nowIso, readStore, writeStore } from '../core/store.js'
import { json } from './shared.js'

export function addProjectCmd(opts: { title: string; note?: string }): string {
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

export function addActionCmd(opts: {
  title: string
  active?: boolean
  deferred?: boolean
  project?: string
  due?: string
  note?: string
}): string {
  const modes = [opts.active, opts.deferred].filter(Boolean).length
  if (modes === 0) {
    throw new InvalidArgument('--active or --deferred is required for actions')
  }
  if (modes > 1) {
    throw new InvalidArgument('--active and --deferred are mutually exclusive')
  }
  const { dataDir } = resolveDataDir()
  const store = readStore(dataDir)
  const due = opts.due !== undefined ? resolveDueInput(opts.due) : null
  const { store: next, entity } = addAction(store, {
    id: newId(),
    created_at: nowIso(),
    title: opts.title,
    status: opts.active ? 'active' : 'deferred',
    project: opts.project ?? null,
    due,
    note: opts.note ?? null,
  })
  writeStore(dataDir, next)
  return json(entity)
}

export function addWaitingCmd(opts: { title: string; project?: string; note?: string }): string {
  const { dataDir } = resolveDataDir()
  const store = readStore(dataDir)
  const { store: next, entity } = addWaiting(store, {
    id: newId(),
    created_at: nowIso(),
    title: opts.title,
    project: opts.project ?? null,
    note: opts.note ?? null,
  })
  writeStore(dataDir, next)
  return json(entity)
}
