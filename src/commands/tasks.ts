import { resolveVault } from '../core/config.js'
import { resolveDueInput } from '../core/dates.js'
import {
  addTask,
  completeTask,
  editTask,
  listTasks,
  removeTask,
  uncompleteTask,
  type EditUpdates,
} from '../core/tasks.js'
import { type ActiveLane, LANES, readProject } from '../core/project.js'
import { loadVault } from '../core/vault.js'
import { parseRef } from '../core/ref.js'
import { IndexOutOfRange } from '../core/errors.js'
import { renderHint } from '../views/atoms.js'
import {
  renderMutation,
  renderTask,
  renderTaskList,
  renderTaskListMulti,
  renderTaskShow,
} from '../views/task.js'

export type LaneFilter = {
  available?: boolean
  waiting?: boolean
  deferred?: boolean
  all?: boolean
}

function resolveListLanes(filter: LaneFilter): readonly ActiveLane[] {
  if (filter.all) return LANES
  const explicit: ActiveLane[] = []
  if (filter.available) explicit.push('available')
  if (filter.waiting) explicit.push('waiting')
  if (filter.deferred) explicit.push('deferred')
  if (explicit.length > 0) return explicit
  return ['available', 'waiting']
}

export function listTasksCmd(
  vaultFlag: string | undefined,
  projectSlug: string | undefined,
  filter: LaneFilter = {},
): string {
  const vault = loadVault(resolveVault(vaultFlag))
  const lanes = resolveListLanes(filter)
  const results = listTasks(vault, projectSlug, { lanes })
  if (results.length === 0) {
    if (!process.stdout.isTTY) return ''
    if (projectSlug) {
      return renderHint(
        `No tasks in '${projectSlug}'. Add one with: todo tasks add --title "..." --project ${projectSlug}`,
      )
    }
    return renderHint('No tasks. Start by creating a project: todo projects add <slug>')
  }
  // Single-lane views render flat. Multi-lane views show context-grouped Available
  // followed by bold-headed Waiting:/Deferred: blocks.
  if (lanes.length === 1) {
    return renderTaskList(results)
  }
  const byLane = {
    available: results.filter((t) => t.lane === 'available'),
    waiting: results.filter((t) => t.lane === 'waiting'),
    deferred: results.filter((t) => t.lane === 'deferred'),
  }
  return renderTaskListMulti(byLane)
}

export type AddLaneFlags = {
  available?: boolean
  waiting?: boolean
  deferred?: boolean
}

function resolveLane(flags: AddLaneFlags): ActiveLane {
  const set = (
    [
      ['available', flags.available],
      ['waiting', flags.waiting],
      ['deferred', flags.deferred],
    ] as const
  ).filter(([, on]) => on)
  if (set.length > 1) {
    throw new Error(
      `pass at most one of --available, --waiting, --deferred (got: ${set.map(([n]) => `--${n}`).join(', ')})`,
    )
  }
  return (set[0]?.[0] as ActiveLane) ?? 'available'
}

function normalizeContexts(raw: string[] | undefined): string[] {
  if (raw === undefined) return []
  // Filter out empty strings (`--context ""` clears, but on add it's effectively no contexts).
  return raw.map((c) => c.trim()).filter((c) => c.length > 0)
}

export function addTaskCmd(
  vaultFlag: string | undefined,
  text: string,
  projectSlug: string,
  due: string | undefined,
  notes: string | undefined,
  laneFlags: AddLaneFlags = {},
  contexts: string[] = [],
): string {
  const vault = loadVault(resolveVault(vaultFlag))
  const resolvedDue = due !== undefined ? resolveDueInput(due) : undefined
  const lane = resolveLane(laneFlags)
  return renderTask(
    addTask(vault, projectSlug, text, resolvedDue, notes, lane, normalizeContexts(contexts)),
  )
}

export function showTaskCmd(vaultFlag: string | undefined, ref: string): string {
  const vault = loadVault(resolveVault(vaultFlag))
  const { slug, index } = parseRef(ref)
  const project = readProject(vault, slug)
  if (index < 1 || index > project.tasks.length) {
    throw new IndexOutOfRange(index, slug, project.tasks.length)
  }
  const t = project.tasks[index - 1]
  return renderTaskShow({
    slug,
    index,
    done: t.done,
    text: t.text,
    lane: t.lane,
    contexts: t.contexts.slice(),
    ...(t.due ? { due: t.due } : {}),
    ...(t.notes ? { notes: t.notes } : {}),
  })
}

export function completeTaskCmd(vaultFlag: string | undefined, ref: string): string {
  const vault = loadVault(resolveVault(vaultFlag))
  return renderMutation(completeTask(vault, ref))
}

export function uncompleteTaskCmd(vaultFlag: string | undefined, ref: string): string {
  const vault = loadVault(resolveVault(vaultFlag))
  return renderMutation(uncompleteTask(vault, ref))
}

export function removeTaskCmd(vaultFlag: string | undefined, ref: string): string {
  const vault = loadVault(resolveVault(vaultFlag))
  return renderMutation(removeTask(vault, ref))
}

export function editTaskCmd(
  vaultFlag: string | undefined,
  ref: string,
  updates: EditUpdates,
  laneFlags: AddLaneFlags = {},
  contexts?: string[],
): string {
  const vault = loadVault(resolveVault(vaultFlag))
  const resolved: EditUpdates = { ...updates }
  if (updates.due !== undefined && updates.due !== '') {
    resolved.due = resolveDueInput(updates.due)
  }
  // Lane flags only set the lane when explicitly passed (any one of them true).
  if (laneFlags.available || laneFlags.waiting || laneFlags.deferred) {
    resolved.lane = resolveLane(laneFlags)
  }
  if (contexts !== undefined) {
    // --context replaces wholesale. `--context ""` clears (filtered to empty list).
    resolved.contexts = normalizeContexts(contexts)
  }
  return renderMutation(editTask(vault, ref, resolved))
}
