import { resolveDataDir } from '../core/config.js'
import { requireFutureDate, resolveDueInput } from '../core/dates.js'
import { InvalidArgument } from '../core/errors.js'
import { addAction, addDeadline, addProject, addWaiting } from '../core/model.js'
import { newId, nowIso, readStore, writeStore } from '../core/store.js'
import { json } from './shared.js'

export function addProjectCmd(opts: { title: string; note?: string; parent?: string }): string {
  if (opts.parent === '') {
    throw new InvalidArgument('--parent cannot be empty on add')
  }
  const { dataDir } = resolveDataDir()
  const store = readStore(dataDir)
  const { store: next, entity } = addProject(store, {
    id: newId(),
    created_at: nowIso(),
    title: opts.title,
    note: opts.note ?? null,
    parent: opts.parent ?? null,
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
  start?: string
  note?: string
}): string {
  const modes = [opts.active, opts.deferred].filter(Boolean).length
  if (modes > 1) {
    throw new InvalidArgument('--active and --deferred are mutually exclusive')
  }
  if (modes === 0 && opts.start === undefined) {
    throw new InvalidArgument('--active, --deferred, or --start is required for actions')
  }
  if (opts.start !== undefined) {
    if (opts.active) throw new InvalidArgument('--start cannot combine with --active')
    if (opts.start === '') throw new InvalidArgument('--start cannot be empty on add')
  }
  const { dataDir } = resolveDataDir()
  const store = readStore(dataDir)
  const due = opts.due !== undefined ? resolveDueInput(opts.due) : null
  const start_at = opts.start !== undefined ? requireFutureDate(opts.start) : null
  const { store: next, entity } = addAction(store, {
    id: newId(),
    created_at: nowIso(),
    title: opts.title,
    status: opts.active ? 'active' : 'deferred',
    project: opts.project ?? null,
    due,
    start_at,
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

export function addDeadlineCmd(opts: {
  title: string
  date: string
  project?: string
  note?: string
}): string {
  const date = requireFutureDate(opts.date)
  const { dataDir } = resolveDataDir()
  const store = readStore(dataDir)
  const { store: next, entity } = addDeadline(store, {
    id: newId(),
    created_at: nowIso(),
    title: opts.title,
    date,
    project: opts.project ?? null,
    note: opts.note ?? null,
  })
  writeStore(dataDir, next)
  return json(entity)
}
