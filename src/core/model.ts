import { InvalidArgument, NotFound, NothingToEdit } from './errors.js'

// Schema ---------------------------------------------------------------

export type BaseList = {
  id: string
  title: string
  note: string | null
  created: string
}

export type ProjectList = BaseList & {
  type: 'project'
  active: boolean
  completed: string | null
  dropped: string | null
}

export type List = ProjectList

export type BaseItem = {
  id: string
  list: string | null
  title: string
  note: string | null
  created: string
}

export type ActionItem = BaseItem & {
  type: 'action'
  active: boolean
  due: string | null
  completed: string | null
  dropped: string | null
}

export type WaitingItem = BaseItem & {
  type: 'waiting'
  completed: string | null
  dropped: string | null
}

export type Item = ActionItem | WaitingItem

export type Store = {
  lists: List[]
  items: Item[]
}

export const EMPTY_STORE: Store = { lists: [], items: [] }

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
  created: string
  title: string
  note?: string | null
}

export function addProject(s: Store, input: AddProjectInput): { store: Store; entity: ProjectList } {
  const entity: ProjectList = {
    id: input.id,
    type: 'project',
    title: requireValidTitle(input.title),
    note: input.note ?? null,
    created: input.created,
    active: true,
    completed: null,
    dropped: null,
  }
  return { store: { ...s, lists: [...s.lists, entity] }, entity }
}

export type AddActionInput = {
  id: string
  created: string
  title: string
  active: boolean
  list?: string | null
  due?: string | null
  note?: string | null
}

export function addAction(s: Store, input: AddActionInput): { store: Store; entity: ActionItem } {
  requireValidTitle(input.title)
  requireListExists(s, input.list)
  const entity: ActionItem = {
    id: input.id,
    type: 'action',
    list: input.list ?? null,
    title: input.title,
    note: input.note ?? null,
    created: input.created,
    active: input.active,
    due: input.due ?? null,
    completed: null,
    dropped: null,
  }
  return { store: { ...s, items: [...s.items, entity] }, entity }
}

export type AddWaitingInput = {
  id: string
  created: string
  title: string
  list?: string | null
  note?: string | null
}

export function addWaiting(s: Store, input: AddWaitingInput): { store: Store; entity: WaitingItem } {
  requireValidTitle(input.title)
  requireListExists(s, input.list)
  const entity: WaitingItem = {
    id: input.id,
    type: 'waiting',
    list: input.list ?? null,
    title: input.title,
    note: input.note ?? null,
    created: input.created,
    completed: null,
    dropped: null,
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
  list?: string | null
}

export function editItem(s: Store, id: string, patch: EditItemPatch): { store: Store; entity: Item } {
  const item = findItem(s, id)
  if (!item) throw new NotFound(`not found: ${id}`)
  if (
    patch.title === undefined &&
    patch.note === undefined &&
    patch.due === undefined &&
    patch.list === undefined
  ) {
    throw new NothingToEdit('nothing to edit')
  }
  if (patch.due !== undefined && item.type === 'waiting') {
    throw new InvalidArgument('--due is not allowed on waiting items')
  }
  if (patch.list !== undefined) requireListExists(s, patch.list)

  if (item.type === 'action') {
    const next: ActionItem = { ...item }
    if (patch.title !== undefined) next.title = requireValidTitle(patch.title)
    if (patch.note !== undefined) next.note = patch.note
    if (patch.due !== undefined) next.due = patch.due
    if (patch.list !== undefined) next.list = patch.list
    return { store: replaceItem(s, next), entity: next }
  }
  const next: WaitingItem = { ...item }
  if (patch.title !== undefined) next.title = requireValidTitle(patch.title)
  if (patch.note !== undefined) next.note = patch.note
  if (patch.list !== undefined) next.list = patch.list
  return { store: replaceItem(s, next), entity: next }
}

// Lifecycle ------------------------------------------------------------

export function setActive(
  s: Store,
  id: string,
  active: boolean,
): { store: Store; entity: ProjectList | ActionItem } {
  const e = requireEntity(s, id)
  if (e.type === 'waiting') {
    throw new InvalidArgument(
      `cannot ${active ? 'activate' : 'defer'} waiting item ${id} (no active flag)`,
    )
  }
  if (e.type === 'project') {
    const next: ProjectList = { ...e, active, completed: null, dropped: null }
    return { store: replaceList(s, next), entity: next }
  }
  const next: ActionItem = { ...e, active, completed: null, dropped: null }
  return { store: replaceItem(s, next), entity: next }
}

export function setCompleted(s: Store, id: string, ts: string): { store: Store; entity: List | Item } {
  const e = requireEntity(s, id)
  if (e.type === 'project') {
    const next: ProjectList = { ...e, completed: ts, dropped: null }
    return { store: replaceList(s, next), entity: next }
  }
  if (e.type === 'action') {
    const next: ActionItem = { ...e, completed: ts, dropped: null }
    return { store: replaceItem(s, next), entity: next }
  }
  const next: WaitingItem = { ...e, completed: ts, dropped: null }
  return { store: replaceItem(s, next), entity: next }
}

export function setDropped(s: Store, id: string, ts: string): { store: Store; entity: List | Item } {
  const e = requireEntity(s, id)
  if (e.type === 'project') {
    const next: ProjectList = { ...e, dropped: ts, completed: null }
    return { store: replaceList(s, next), entity: next }
  }
  if (e.type === 'action') {
    const next: ActionItem = { ...e, dropped: ts, completed: null }
    return { store: replaceItem(s, next), entity: next }
  }
  const next: WaitingItem = { ...e, dropped: ts, completed: null }
  return { store: replaceItem(s, next), entity: next }
}

// Bucket helpers -------------------------------------------------------

function isItemTerminal(i: Item): boolean {
  return i.completed !== null || i.dropped !== null
}

function isListTerminal(l: List): boolean {
  return l.completed !== null || l.dropped !== null
}

function parentActive(s: Store, listId: string | null): boolean {
  if (listId === null) return true
  const parent = findList(s, listId)
  if (!parent) return true
  return parent.active && !isListTerminal(parent)
}

export function liveActions(s: Store): ActionItem[] {
  return s.items.filter(
    (i): i is ActionItem =>
      i.type === 'action' && i.active && !isItemTerminal(i) && parentActive(s, i.list),
  )
}

export function deferredActions(s: Store): ActionItem[] {
  return s.items.filter(
    (i): i is ActionItem =>
      i.type === 'action' && !i.active && !isItemTerminal(i) && parentActive(s, i.list),
  )
}

export function liveWaiting(s: Store): WaitingItem[] {
  return s.items.filter(
    (i): i is WaitingItem =>
      i.type === 'waiting' && !isItemTerminal(i) && parentActive(s, i.list),
  )
}

export function activeProjects(s: Store): ProjectList[] {
  return s.lists.filter((l) => l.type === 'project' && l.active && !isListTerminal(l))
}

export function deferredProjects(s: Store): ProjectList[] {
  return s.lists.filter((l) => l.type === 'project' && !l.active && !isListTerminal(l))
}
