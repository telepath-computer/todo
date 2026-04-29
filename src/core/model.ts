import { InvalidArgument, NotFound, NothingToEdit } from './errors.js'

// Schema ---------------------------------------------------------------

export type Status = 'active' | 'deferred' | 'completed' | 'dropped'
export type WaitingStatus = Exclude<Status, 'deferred'>
export type DeadlineStatus = 'active' | 'dropped'

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
  start_at: string | null      // YYYY-MM-DD; only meaningful when status='deferred'
  closed_at: string | null
}

export type WaitingItem = BaseItem & {
  type: 'waiting'
  status: WaitingStatus
  closed_at: string | null
}

export type DeadlineItem = BaseItem & {
  type: 'deadline'
  status: DeadlineStatus
  date: string                 // YYYY-MM-DD; required, never null
  closed_at: string | null     // non-null iff status='dropped'
}

export type Item = ActionItem | WaitingItem | DeadlineItem

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
  start_at?: string | null
}

export function addAction(s: Store, input: AddActionInput): { store: Store; entity: ActionItem } {
  requireValidTitle(input.title)
  requireListExists(s, input.project)
  const start_at = input.status === 'deferred' ? (input.start_at ?? null) : null
  const entity: ActionItem = {
    id: input.id,
    type: 'action',
    project: input.project ?? null,
    title: input.title,
    note: input.note ?? null,
    created_at: input.created_at,
    status: input.status,
    due: input.due ?? null,
    start_at,
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

export type AddDeadlineInput = {
  id: string
  created_at: string
  title: string
  date: string
  project?: string | null
  note?: string | null
}

export function addDeadline(s: Store, input: AddDeadlineInput): { store: Store; entity: DeadlineItem } {
  requireValidTitle(input.title)
  requireListExists(s, input.project)
  const entity: DeadlineItem = {
    id: input.id,
    type: 'deadline',
    project: input.project ?? null,
    title: input.title,
    note: input.note ?? null,
    created_at: input.created_at,
    status: 'active',
    date: input.date,
    closed_at: null,
  }
  return { store: { ...s, items: [...s.items, entity] }, entity }
}

// Note append ----------------------------------------------------------

export function appendNote(
  s: Store,
  id: string,
  body: string,
): { store: Store; entity: List | Item } {
  if (body.trim().length === 0) {
    throw new InvalidArgument('body is required and cannot be empty')
  }
  const e = requireEntity(s, id)
  const next = e.note === null ? body : `${e.note}\n\n${body}`
  if (e.type === 'project') {
    const updated: ProjectList = { ...e, note: next }
    return { store: replaceList(s, updated), entity: updated }
  }
  if (e.type === 'action') {
    const updated: ActionItem = { ...e, note: next }
    return { store: replaceItem(s, updated), entity: updated }
  }
  if (e.type === 'waiting') {
    const updated: WaitingItem = { ...e, note: next }
    return { store: replaceItem(s, updated), entity: updated }
  }
  const updated: DeadlineItem = { ...e, note: next }
  return { store: replaceItem(s, updated), entity: updated }
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
  start_at?: string | null
  date?: string
}

export function editItem(s: Store, id: string, patch: EditItemPatch): { store: Store; entity: Item } {
  const item = findItem(s, id)
  if (!item) throw new NotFound(`not found: ${id}`)
  if (
    patch.title === undefined &&
    patch.note === undefined &&
    patch.due === undefined &&
    patch.project === undefined &&
    patch.start_at === undefined &&
    patch.date === undefined
  ) {
    throw new NothingToEdit('nothing to edit')
  }
  if (patch.due !== undefined && item.type === 'waiting') {
    throw new InvalidArgument('--due is not allowed on waiting items')
  }
  if (patch.due !== undefined && item.type === 'deadline') {
    throw new InvalidArgument('--due is not allowed on deadlines')
  }
  if (patch.start_at !== undefined && item.type === 'waiting') {
    throw new InvalidArgument('--start is not allowed on waiting items')
  }
  if (patch.start_at !== undefined && item.type === 'deadline') {
    throw new InvalidArgument('--start is not allowed on deadlines')
  }
  if (patch.date !== undefined && item.type === 'action') {
    throw new InvalidArgument('--date is not allowed on actions')
  }
  if (patch.date !== undefined && item.type === 'waiting') {
    throw new InvalidArgument('--date is not allowed on waiting items')
  }
  if (patch.project !== undefined) requireListExists(s, patch.project)

  if (item.type === 'action') {
    const next: ActionItem = { ...item }
    if (patch.title !== undefined) next.title = requireValidTitle(patch.title)
    if (patch.note !== undefined) next.note = patch.note
    if (patch.due !== undefined) next.due = patch.due
    if (patch.project !== undefined) next.project = patch.project
    if (patch.start_at !== undefined) next.start_at = patch.start_at
    return { store: replaceItem(s, next), entity: next }
  }
  if (item.type === 'deadline') {
    const next: DeadlineItem = { ...item }
    if (patch.title !== undefined) next.title = requireValidTitle(patch.title)
    if (patch.note !== undefined) next.note = patch.note
    if (patch.date !== undefined) next.date = patch.date
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

// Discriminated union: each status carries the data it needs.
export type StatusTransition =
  | { status: 'active' }
  | { status: 'deferred'; start_at: string | null }
  | { status: 'completed'; closed_at: string }
  | { status: 'dropped'; closed_at: string }

export function setStatus(
  s: Store,
  id: string,
  t: StatusTransition,
): { store: Store; entity: List | Item } {
  const e = requireEntity(s, id)
  const closed_at = t.status === 'completed' || t.status === 'dropped' ? t.closed_at : null

  if (e.type === 'waiting') {
    if (!isTerminal(t.status)) {
      throw new InvalidArgument(
        `cannot ${t.status === 'deferred' ? 'defer' : 'activate'} waiting item ${id} ` +
          `(waiting items only transition to completed/dropped)`,
      )
    }
    const next: WaitingItem = { ...e, status: t.status, closed_at }
    return { store: replaceItem(s, next), entity: next }
  }
  if (e.type === 'deadline') {
    if (t.status === 'completed') {
      throw new InvalidArgument(
        `cannot complete deadline ${id} (deadlines are not tasks; use drop)`,
      )
    }
    if (t.status === 'deferred') {
      throw new InvalidArgument(
        `cannot defer deadline ${id} (deadlines have no deferred state)`,
      )
    }
    const next: DeadlineItem = { ...e, status: t.status, closed_at }
    return { store: replaceItem(s, next), entity: next }
  }
  if (e.type === 'project') {
    const next: ProjectList = { ...e, status: t.status, closed_at }
    return { store: replaceList(s, next), entity: next }
  }
  // action
  const start_at = t.status === 'deferred' ? t.start_at : null
  const next: ActionItem = { ...e, status: t.status, closed_at, start_at }
  return { store: replaceItem(s, next), entity: next }
}

// Bucket helpers -------------------------------------------------------
//
// `today` is a YYYY-MM-DD string (host-local). Past-due scheduled items
// (status='deferred', start_at <= today) are promoted into liveActions
// automatically; deferredActions excludes them to avoid double-counting.

function parentActive(s: Store, projectId: string | null): boolean {
  if (projectId === null) return true
  const parent = findList(s, projectId)
  if (!parent) return true
  return parent.status === 'active'
}

function isAction(i: Item): i is ActionItem {
  return i.type === 'action'
}

export function liveActions(s: Store, today: string): ActionItem[] {
  return s.items.filter((i): i is ActionItem => {
    if (!isAction(i)) return false
    if (!parentActive(s, i.project)) return false
    if (i.status === 'active') return true
    if (i.status === 'deferred' && i.start_at !== null && i.start_at <= today) return true
    return false
  })
}

export function deferredActions(s: Store, today: string): ActionItem[] {
  return s.items.filter(
    (i): i is ActionItem =>
      isAction(i) &&
      i.status === 'deferred' &&
      (i.start_at === null || i.start_at > today) &&
      parentActive(s, i.project),
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

export function activeDeadlines(s: Store, today: string): DeadlineItem[] {
  return s.items.filter(
    (i): i is DeadlineItem =>
      i.type === 'deadline' &&
      i.status === 'active' &&
      i.date >= today &&
      parentActive(s, i.project),
  )
}

// Project-scoped buckets for `todo show <project-id>`. These mirror the
// dashboard buckets but skip the parent-cascade filter — when drilling into
// a specific project, the user wants its contents regardless of the
// project's own status.

export function projectActiveActions(s: Store, today: string, projectId: string): ActionItem[] {
  return s.items.filter((i): i is ActionItem => {
    if (!isAction(i)) return false
    if (i.project !== projectId) return false
    if (i.status === 'active') return true
    if (i.status === 'deferred' && i.start_at !== null && i.start_at <= today) return true
    return false
  })
}

export function projectDeferredActions(s: Store, today: string, projectId: string): ActionItem[] {
  return s.items.filter(
    (i): i is ActionItem =>
      isAction(i) &&
      i.project === projectId &&
      i.status === 'deferred' &&
      (i.start_at === null || i.start_at > today),
  )
}

export function projectWaiting(s: Store, projectId: string): WaitingItem[] {
  return s.items.filter(
    (i): i is WaitingItem =>
      i.type === 'waiting' && i.project === projectId && i.status === 'active',
  )
}

export function projectDeadlines(s: Store, today: string, projectId: string): DeadlineItem[] {
  return s.items.filter(
    (i): i is DeadlineItem =>
      i.type === 'deadline' &&
      i.project === projectId &&
      i.status === 'active' &&
      i.date >= today,
  )
}
