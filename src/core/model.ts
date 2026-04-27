import { InvalidArgument, NotFound, NothingToEdit } from './errors.js'

// Schema ---------------------------------------------------------------

export type Status = 'active' | 'deferred' | 'completed' | 'dropped'
export type WaitingStatus = Exclude<Status, 'deferred'>

export type BaseList = {
  id: string
  title: string
  note: string | null
  created_at: string
}

export type ProjectList = BaseList & {
  type: 'project'
  status: Status
  closed_at: string | null     // ISO ts; non-null iff status is completed/dropped
}

export type List = ProjectList

export type BaseItem = {
  id: string
  project: string | null
  title: string
  note: string | null
  created_at: string
}

export type ActionItem = BaseItem & {
  type: 'action'
  status: Status
  due: string | null
  closed_at: string | null
}

export type WaitingItem = BaseItem & {
  type: 'waiting'
  status: WaitingStatus
  closed_at: string | null
}

export type Item = ActionItem | WaitingItem

export type Store = {
  lists: List[]
  items: Item[]
}

export const EMPTY_STORE: Store = { lists: [], items: [] }

const TERMINAL_STATUSES: ReadonlySet<Status> = new Set(['completed', 'dropped'])

export function isTerminal(s: Status): s is 'completed' | 'dropped' {
  return TERMINAL_STATUSES.has(s)
}

// Lookup ---------------------------------------------------------------

export function findList(s: Store, id: string): List | undefined {
  return s.lists.find((l) => l.id === id)
}

export function findItem(s: Store, id: string): Item | undefined {
  return s.items.find((i) => i.id === id)
}

export function findEntity(s: Store, id: string): List | Item | undefined {
  return findList(s, id) ?? findItem(s, id)
}

export function resolveRef(s: Store, ref: string): List | Item {
  const e = findEntity(s, ref)
  if (!e) throw new NotFound(`not found: ${ref}`)
  return e
}

// Helpers --------------------------------------------------------------

function requireEntity(s: Store, id: string): List | Item {
  const e = findEntity(s, id)
  if (!e) throw new NotFound(`not found: ${id}`)
  return e
}

function isTitleValid(t: string): boolean {
  return t.trim().length > 0
}

function requireValidTitle(t: string): string {
  if (!isTitleValid(t)) throw new InvalidArgument('title is required and cannot be empty')
  return t
}

function requireListExists(s: Store, listId: string | null | undefined): void {
  if (listId === null || listId === undefined) return
  if (!findList(s, listId)) throw new InvalidArgument(`unknown project: ${listId}`)
}

function replaceList(s: Store, next: List): Store {
  return { ...s, lists: s.lists.map((l) => (l.id === next.id ? next : l)) }
}

function replaceItem(s: Store, next: Item): Store {
  return { ...s, items: s.items.map((i) => (i.id === next.id ? next : i)) }
}

// Insert ---------------------------------------------------------------

export type AddProjectInput = {
  id: string
  created_at: string
  title: string
  note?: string | null
}

export function addProject(s: Store, input: AddProjectInput): { store: Store; entity: ProjectList } {
  const entity: ProjectList = {
    id: input.id,
    type: 'project',
    title: requireValidTitle(input.title),
    note: input.note ?? null,
    created_at: input.created_at,
    status: 'active',
    closed_at: null,
  }
  return { store: { ...s, lists: [...s.lists, entity] }, entity }
}

export type AddActionInput = {
  id: string
  created_at: string
  title: string
  status: 'active' | 'deferred'
  project?: string | null
  due?: string | null
  note?: string | null
}

export function addAction(s: Store, input: AddActionInput): { store: Store; entity: ActionItem } {
  requireValidTitle(input.title)
  requireListExists(s, input.project)
  const entity: ActionItem = {
    id: input.id,
    type: 'action',
    project: input.project ?? null,
    title: input.title,
    note: input.note ?? null,
    created_at: input.created_at,
    status: input.status,
    due: input.due ?? null,
    closed_at: null,
  }
  return { store: { ...s, items: [...s.items, entity] }, entity }
}

export type AddWaitingInput = {
  id: string
  created_at: string
  title: string
  project?: string | null
  note?: string | null
}

export function addWaiting(s: Store, input: AddWaitingInput): { store: Store; entity: WaitingItem } {
  requireValidTitle(input.title)
  requireListExists(s, input.project)
  const entity: WaitingItem = {
    id: input.id,
    type: 'waiting',
    project: input.project ?? null,
    title: input.title,
    note: input.note ?? null,
    created_at: input.created_at,
    status: 'active',
    closed_at: null,
  }
  return { store: { ...s, items: [...s.items, entity] }, entity }
}

// Edit -----------------------------------------------------------------

export type EditListPatch = {
  title?: string
  note?: string | null
}

export function editList(s: Store, id: string, patch: EditListPatch): { store: Store; entity: ProjectList } {
  const list = findList(s, id)
  if (!list) throw new NotFound(`not found: ${id}`)
  if (patch.title === undefined && patch.note === undefined) {
    throw new NothingToEdit('nothing to edit')
  }
  const next: ProjectList = { ...list }
  if (patch.title !== undefined) next.title = requireValidTitle(patch.title)
  if (patch.note !== undefined) next.note = patch.note
  return { store: replaceList(s, next), entity: next }
}

export type EditItemPatch = {
  title?: string
  note?: string | null
  due?: string | null
  project?: string | null
}

export function editItem(s: Store, id: string, patch: EditItemPatch): { store: Store; entity: Item } {
  const item = findItem(s, id)
  if (!item) throw new NotFound(`not found: ${id}`)
  if (
    patch.title === undefined &&
    patch.note === undefined &&
    patch.due === undefined &&
    patch.project === undefined
  ) {
    throw new NothingToEdit('nothing to edit')
  }
  if (patch.due !== undefined && item.type === 'waiting') {
    throw new InvalidArgument('--due is not allowed on waiting items')
  }
  if (patch.project !== undefined) requireListExists(s, patch.project)

  if (item.type === 'action') {
    const next: ActionItem = { ...item }
    if (patch.title !== undefined) next.title = requireValidTitle(patch.title)
    if (patch.note !== undefined) next.note = patch.note
    if (patch.due !== undefined) next.due = patch.due
    if (patch.project !== undefined) next.project = patch.project
    return { store: replaceItem(s, next), entity: next }
  }
  const next: WaitingItem = { ...item }
  if (patch.title !== undefined) next.title = requireValidTitle(patch.title)
  if (patch.note !== undefined) next.note = patch.note
  if (patch.project !== undefined) next.project = patch.project
  return { store: replaceItem(s, next), entity: next }
}

// Lifecycle ------------------------------------------------------------

export function setStatus(
  s: Store,
  id: string,
  status: Status,
  ts: string | null,
): { store: Store; entity: List | Item } {
  // Argument shape invariants — same for every entity type.
  if (isTerminal(status) && ts === null) {
    throw new InvalidArgument(`status "${status}" requires a timestamp`)
  }
  if (!isTerminal(status) && ts !== null) {
    throw new InvalidArgument(`status "${status}" must not have a timestamp`)
  }

  const e = requireEntity(s, id)
  const closed_at = isTerminal(status) ? ts : null

  if (e.type === 'waiting') {
    if (!isTerminal(status)) {
      throw new InvalidArgument(
        `cannot ${status === 'deferred' ? 'defer' : 'activate'} waiting item ${id} ` +
          `(waiting items only transition to completed/dropped)`,
      )
    }
    const next: WaitingItem = { ...e, status, closed_at }
    return { store: replaceItem(s, next), entity: next }
  }
  if (e.type === 'project') {
    const next: ProjectList = { ...e, status, closed_at }
    return { store: replaceList(s, next), entity: next }
  }
  const next: ActionItem = { ...e, status, closed_at }
  return { store: replaceItem(s, next), entity: next }
}

// Bucket helpers -------------------------------------------------------

function parentActive(s: Store, projectId: string | null): boolean {
  if (projectId === null) return true
  const parent = findList(s, projectId)
  if (!parent) return true
  return parent.status === 'active'
}

export function liveActions(s: Store): ActionItem[] {
  return s.items.filter(
    (i): i is ActionItem => i.type === 'action' && i.status === 'active' && parentActive(s, i.project),
  )
}

export function deferredActions(s: Store): ActionItem[] {
  return s.items.filter(
    (i): i is ActionItem => i.type === 'action' && i.status === 'deferred' && parentActive(s, i.project),
  )
}

export function liveWaiting(s: Store): WaitingItem[] {
  return s.items.filter(
    (i): i is WaitingItem => i.type === 'waiting' && i.status === 'active' && parentActive(s, i.project),
  )
}

export function activeProjects(s: Store): ProjectList[] {
  return s.lists.filter((l) => l.type === 'project' && l.status === 'active')
}

export function deferredProjects(s: Store): ProjectList[] {
  return s.lists.filter((l) => l.type === 'project' && l.status === 'deferred')
}
