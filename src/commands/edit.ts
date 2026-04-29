import { resolveDataDir } from '../core/config.js'
import { requireFutureDate, resolveDueInput } from '../core/dates.js'
import { InvalidArgument, NotFound, NothingToEdit } from '../core/errors.js'
import {
  appendNote,
  editItem,
  editList,
  findEntity,
  setStatus,
  type EditItemPatch,
  type EditListPatch,
  type Item,
  type List,
  type Status,
  type StatusTransition,
} from '../core/model.js'
import { nowIso, readStore, writeStore } from '../core/store.js'
import { json } from './shared.js'

export type EditCmdOpts = {
  active?: boolean
  deferred?: boolean
  completed?: boolean
  dropped?: boolean
  pinned?: boolean
  start?: string
  title?: string
  note?: string
  noteAppend?: string
  due?: string
  project?: string
  parent?: string
  date?: string
}

export function editCmd(id: string, opts: EditCmdOpts): string {
  const { dataDir } = resolveDataDir()
  const store = readStore(dataDir)
  const entity = findEntity(store, id)
  if (!entity) throw new NotFound(`not found: ${id}`)

  if (opts.note !== undefined && opts.noteAppend !== undefined) {
    throw new InvalidArgument('--note and --note-append are mutually exclusive')
  }

  const wantStatus = resolveWantStatus(opts)

  if (entity.type === 'memo') {
    if (wantStatus !== null) throw new InvalidArgument(`${id} is a memo and has no status`)
    if (opts.start !== undefined) throw new InvalidArgument('--start is not allowed on memos')
    if (opts.due !== undefined) throw new InvalidArgument('--due is not allowed on memos')
    if (opts.date !== undefined) throw new InvalidArgument('--date is not allowed on memos')
    if (opts.parent !== undefined) throw new InvalidArgument('--parent is not allowed on memos')
    if (opts.title !== undefined) throw new InvalidArgument('--title is not allowed on memos')
    if (opts.noteAppend !== undefined) throw new InvalidArgument('--note-append is not allowed on memos')

    const patch: EditItemPatch = {}
    if (opts.note !== undefined) patch.note = opts.note
    if (opts.pinned !== undefined) patch.pinned = opts.pinned
    if (opts.project !== undefined) patch.project = opts.project === '' ? null : opts.project

    const result = editItem(store, id, patch)
    writeStore(dataDir, result.store)
    return json(result.entity)
  }

  if (opts.note !== undefined) throw new InvalidArgument('--note is only allowed on memos')
  if (opts.pinned !== undefined) throw new InvalidArgument('--pinned is only allowed on memos')

  if (entity.type === 'project') {
    if (opts.start !== undefined) throw new InvalidArgument('--start is not allowed on projects')
    if (opts.due !== undefined) throw new InvalidArgument('--due is not allowed on projects')
    if (opts.date !== undefined) throw new InvalidArgument('--date is not allowed on projects')
    if (opts.project !== undefined) throw new InvalidArgument('--project is not allowed on projects')
  } else if (entity.type === 'waiting') {
    if (opts.start !== undefined) throw new InvalidArgument('--start is not allowed on waiting items')
    if (opts.date !== undefined) throw new InvalidArgument('--date is not allowed on waiting items')
    if (opts.parent !== undefined) throw new InvalidArgument('--parent is not allowed on waiting items')
    if (wantStatus === 'active' || wantStatus === 'deferred') {
      throw new InvalidArgument(
        `cannot ${wantStatus === 'deferred' ? 'defer' : 'activate'} waiting item ${id} ` +
          `(waiting items only transition to completed/dropped)`,
      )
    }
    if (opts.due !== undefined) throw new InvalidArgument('--due is not allowed on waiting items')
  } else if (entity.type === 'deadline') {
    if (opts.start !== undefined) throw new InvalidArgument('--start is not allowed on deadlines')
    if (opts.due !== undefined) throw new InvalidArgument('--due is not allowed on deadlines')
    if (opts.parent !== undefined) throw new InvalidArgument('--parent is not allowed on deadlines')
    if (wantStatus === 'completed') {
      throw new InvalidArgument(
        `cannot complete deadline ${id} (deadlines are not tasks; use drop)`,
      )
    }
    if (wantStatus === 'deferred') {
      throw new InvalidArgument(
        `cannot defer deadline ${id} (deadlines have no deferred state)`,
      )
    }
  } else if (entity.type === 'action') {
    if (opts.date !== undefined) throw new InvalidArgument('--date is not allowed on actions')
    if (opts.parent !== undefined) throw new InvalidArgument('--parent is not allowed on actions')
  }

  if (opts.start !== undefined) {
    if (wantStatus === 'active') throw new InvalidArgument('--start requires --deferred')
    if (wantStatus === 'completed' || wantStatus === 'dropped') {
      throw new InvalidArgument('--start is not allowed with --completed / --dropped')
    }
  }

  let startVal: string | null | undefined = undefined
  if (opts.start !== undefined) {
    startVal = opts.start === '' ? null : requireFutureDate(opts.start)
  }

  let dateVal: string | undefined = undefined
  if (opts.date !== undefined) {
    if (opts.date === '') {
      throw new InvalidArgument('date is required and cannot be empty')
    }
    dateVal = requireFutureDate(opts.date)
  }

  let effectiveStatus = wantStatus
  if (effectiveStatus === null && startVal !== undefined && startVal !== null && entity.type === 'action') {
    effectiveStatus = 'deferred'
  }

  const transition = buildTransition(effectiveStatus, startVal)

  let nextStore = store
  let nextEntity: List | Item = entity
  let didMutate = false

  if (transition !== null) {
    const result = setStatus(nextStore, id, transition)
    nextStore = result.store
    nextEntity = result.entity
    didMutate = true
  }

  const hasFieldEdits =
    opts.title !== undefined ||
    opts.due !== undefined ||
    opts.project !== undefined ||
    opts.parent !== undefined ||
    dateVal !== undefined
  const startClearOnly = transition === null && startVal === null && entity.type === 'action'

  if (hasFieldEdits || startClearOnly) {
    if (entity.type === 'project') {
      const patch: EditListPatch = {}
      if (opts.title !== undefined) patch.title = opts.title
      if (opts.parent !== undefined) patch.parent = opts.parent === '' ? null : opts.parent
      const result = editList(nextStore, id, patch)
      nextStore = result.store
      nextEntity = result.entity
    } else {
      const patch: EditItemPatch = {}
      if (opts.title !== undefined) patch.title = opts.title
      if (opts.due !== undefined) patch.due = opts.due === '' ? null : resolveDueInput(opts.due)
      if (opts.project !== undefined) patch.project = opts.project === '' ? null : opts.project
      if (startClearOnly) patch.start_at = null
      if (dateVal !== undefined) patch.date = dateVal
      const result = editItem(nextStore, id, patch)
      nextStore = result.store
      nextEntity = result.entity
    }
    didMutate = true
  }

  if (opts.noteAppend !== undefined) {
    const result = appendNote(nextStore, id, opts.noteAppend)
    nextStore = result.store
    nextEntity = result.entity
    didMutate = true
  }

  if (!didMutate) throw new NothingToEdit('nothing to edit')

  writeStore(dataDir, nextStore)
  return json(nextEntity)
}

function resolveWantStatus(opts: EditCmdOpts): Status | null {
  const flags = [opts.active, opts.deferred, opts.completed, opts.dropped].filter(Boolean).length
  if (flags > 1) {
    throw new InvalidArgument('--active, --deferred, --completed, --dropped are mutually exclusive')
  }
  if (opts.active) return 'active'
  if (opts.deferred) return 'deferred'
  if (opts.completed) return 'completed'
  if (opts.dropped) return 'dropped'
  return null
}

function buildTransition(
  status: Status | null,
  startVal: string | null | undefined,
): StatusTransition | null {
  if (status === 'active') return { status: 'active' }
  if (status === 'deferred') {
    return { status: 'deferred', start_at: startVal === undefined ? null : startVal }
  }
  if (status === 'completed') return { status: 'completed', closed_at: nowIso() }
  if (status === 'dropped') return { status: 'dropped', closed_at: nowIso() }
  return null
}
