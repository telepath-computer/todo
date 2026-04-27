import { IndexOutOfRange, InvalidDate, NothingToEdit } from './errors.js'
import {
  type ActiveLane,
  type Lane,
  LANES,
  type Task,
  listProjectSlugs,
  readProject,
  sanitizeTaskNote,
  writeProject,
} from './project.js'
import { parseRef } from './ref.js'
import type { Vault } from './vault.js'

const ALL_LANES: readonly Lane[] = ['available', 'waiting', 'deferred', 'completed'] as const

function todayISO(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export type TaskResult = {
  slug: string
  index: number
  done: boolean
  text: string
  lane: Lane
  contexts: string[]
  due?: string
  notes?: string
}

export type ShiftInfo = { slug: string; afterIndex: number }

export type MutationResult = {
  task: TaskResult
  shift?: ShiftInfo
  movedFrom?: string
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function validateDate(value: string): void {
  if (!DATE_RE.test(value)) throw new InvalidDate(value)
}

function toResult(slug: string, index: number, task: Task): TaskResult {
  return {
    slug,
    index,
    done: task.done,
    text: task.text,
    lane: task.lane,
    contexts: task.contexts.slice(),
    ...(task.due ? { due: task.due } : {}),
    ...(task.notes ? { notes: task.notes } : {}),
    ...(task.completedAt ? { completedAt: task.completedAt } : {}),
  }
}

// Re-sort the project's flat tasks list into canonical order: available → waiting → deferred → completed,
// preserving in-lane order. Stable for items already in canonical order.
function sortByLane(tasks: Task[]): Task[] {
  const out: Task[] = []
  for (const lane of ALL_LANES) {
    for (const t of tasks) if (t.lane === lane) out.push(t)
  }
  return out
}

export type ListFilter = { lanes?: readonly Lane[] }

const DEFAULT_LIST_LANES: readonly Lane[] = ['available', 'waiting']

export function listTasks(
  vault: Vault,
  projectSlug?: string,
  filter: ListFilter = {},
): TaskResult[] {
  const lanes = filter.lanes ?? DEFAULT_LIST_LANES
  const slugs = projectSlug ? [projectSlug] : listProjectSlugs(vault)
  const results: TaskResult[] = []
  for (const slug of slugs) {
    const project = readProject(vault, slug)
    project.tasks.forEach((t, i) => {
      if (lanes.includes(t.lane)) {
        results.push(toResult(slug, i + 1, t))
      }
    })
  }
  return results
}

export function addTask(
  vault: Vault,
  projectSlug: string,
  text: string,
  due?: string,
  notes?: string,
  lane: Lane = 'available',
  contexts: string[] = [],
): TaskResult {
  if (due !== undefined) validateDate(due)
  const project = readProject(vault, projectSlug)
  const task: Task = { done: false, text, lane, contexts: contexts.slice() }
  if (due) task.due = due
  if (notes && notes.trim().length > 0) {
    task.notes = sanitizeTaskNote(notes.trim())
  }
  project.tasks.push(task)
  project.tasks = sortByLane(project.tasks)
  writeProject(vault, project)
  const newIndex = project.tasks.indexOf(task) + 1
  return toResult(projectSlug, newIndex, task)
}

function laneMutate(
  vault: Vault,
  ref: string,
  mutate: (task: Task) => Task,
): MutationResult {
  const { slug, index } = parseRef(ref)
  const project = readProject(vault, slug)
  if (index < 1 || index > project.tasks.length) {
    throw new IndexOutOfRange(index, slug, project.tasks.length)
  }
  const before = project.tasks[index - 1]
  const after = mutate(before)
  project.tasks[index - 1] = after
  project.tasks = sortByLane(project.tasks)
  writeProject(vault, project)
  const newIndex = project.tasks.indexOf(after) + 1
  // Shift note when the task's position moved (lane change).
  const shifted = newIndex !== index
  return {
    task: toResult(slug, newIndex, after),
    ...(shifted ? { shift: { slug, afterIndex: Math.min(index, newIndex) } } : {}),
  }
}

export function completeTask(vault: Vault, ref: string, now: Date = new Date()): MutationResult {
  return laneMutate(vault, ref, (t) => ({
    ...t,
    done: true,
    lane: 'completed',
    completedAt: todayISO(now),
  }))
}

export function uncompleteTask(vault: Vault, ref: string): MutationResult {
  return laneMutate(vault, ref, (t) => {
    const { completedAt: _, ...rest } = t
    return { ...rest, done: false, lane: 'available' }
  })
}

export function removeTask(vault: Vault, ref: string): MutationResult {
  const { slug, index } = parseRef(ref)
  const project = readProject(vault, slug)
  if (index < 1 || index > project.tasks.length) {
    throw new IndexOutOfRange(index, slug, project.tasks.length)
  }
  const preLen = project.tasks.length
  const removed = project.tasks[index - 1]
  project.tasks.splice(index - 1, 1)
  writeProject(vault, project)
  return {
    task: toResult(slug, index, removed),
    ...(index < preLen ? { shift: { slug, afterIndex: index } } : {}),
  }
}

export type EditUpdates = {
  title?: string
  due?: string
  project?: string
  notes?: string
  lane?: Lane
  contexts?: string[]
}

export function editTask(
  vault: Vault,
  ref: string,
  updates: EditUpdates,
): MutationResult {
  if (
    updates.title === undefined &&
    updates.due === undefined &&
    updates.project === undefined &&
    updates.notes === undefined &&
    updates.lane === undefined &&
    updates.contexts === undefined
  ) {
    throw new NothingToEdit()
  }
  if (updates.due !== undefined && updates.due !== '') validateDate(updates.due)

  const { slug: sourceSlug, index } = parseRef(ref)
  const sourceProject = readProject(vault, sourceSlug)
  if (index < 1 || index > sourceProject.tasks.length) {
    throw new IndexOutOfRange(index, sourceSlug, sourceProject.tasks.length)
  }

  const current = sourceProject.tasks[index - 1]
  const newText = updates.title !== undefined ? updates.title : current.text
  const newDue =
    updates.due === undefined
      ? current.due
      : updates.due === ''
        ? undefined
        : updates.due
  const newNotes =
    updates.notes === undefined
      ? current.notes
      : updates.notes.trim().length > 0
        ? sanitizeTaskNote(updates.notes.trim())
        : undefined
  const newLane: Lane = updates.lane !== undefined ? updates.lane : current.lane
  const newContexts =
    updates.contexts !== undefined ? updates.contexts.slice() : current.contexts.slice()
  const newTask: Task = { done: current.done, text: newText, lane: newLane, contexts: newContexts }
  if (newDue) newTask.due = newDue
  if (newNotes) newTask.notes = newNotes

  const isMove = updates.project !== undefined && updates.project !== sourceSlug

  if (!isMove) {
    sourceProject.tasks[index - 1] = newTask
    sourceProject.tasks = sortByLane(sourceProject.tasks)
    writeProject(vault, sourceProject)
    const newIndex = sourceProject.tasks.indexOf(newTask) + 1
    const laneShifted = newLane !== current.lane && newIndex !== index
    return {
      task: toResult(sourceSlug, newIndex, newTask),
      ...(laneShifted ? { shift: { slug: sourceSlug, afterIndex: Math.min(index, newIndex) } } : {}),
    }
  }

  // Move across projects. Validate target first so a bad slug leaves source untouched.
  const targetSlug = updates.project as string
  const targetProject = readProject(vault, targetSlug)

  const preLen = sourceProject.tasks.length
  sourceProject.tasks.splice(index - 1, 1)
  targetProject.tasks.push(newTask)
  targetProject.tasks = sortByLane(targetProject.tasks)

  writeProject(vault, sourceProject)
  writeProject(vault, targetProject)

  const newIndex = targetProject.tasks.indexOf(newTask) + 1
  return {
    task: toResult(targetSlug, newIndex, newTask),
    movedFrom: sourceSlug,
    ...(index < preLen ? { shift: { slug: sourceSlug, afterIndex: index } } : {}),
  }
}
