import pc from 'picocolors'
import type { MutationResult, TaskResult } from '../core/tasks.js'
import { renderCheckbox, renderRef } from './atoms.js'

function localIso(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function renderDueDate(date: string, now: Date = new Date()): string {
  const label = `!${date}`
  const today = localIso(now)
  if (date < today) return pc.red(label)
  if (date === today) return pc.yellow(label)
  return pc.dim(label)
}

export function renderTask(task: TaskResult): string {
  const isTTY = process.stdout.isTTY ?? false
  const width = process.stdout.columns ?? 80

  const checkboxPlain = task.done ? '[x]' : '[ ]'
  const duePlain = task.due ? `!${task.due}` : ''
  const refPlain = `[${task.slug}#${task.index}]`
  const leftPlain = `${checkboxPlain} ${task.text}`
  const rightPlain = (duePlain ? duePlain + ' ' : '') + refPlain

  const styledLeft = `${renderCheckbox(task.done)} ${task.text}`
  const styledRight =
    (task.due ? `${renderDueDate(task.due)} ` : '') +
    renderRef(task.slug, task.index)

  if (isTTY) {
    const pad = Math.max(1, width - leftPlain.length - rightPlain.length)
    return styledLeft + ' '.repeat(pad) + styledRight
  }
  return `${styledLeft} ${styledRight}`
}

function renderNotePreview(notes: string, width: number): string {
  const lines = notes.split('\n')
  const firstLine = lines[0]
  const hasMore = lines.length > 1
  const maxWidth = Math.max(8, width - 4) // 4-space indent
  let content: string
  if (!hasMore && firstLine.length <= maxWidth) {
    content = firstLine
  } else {
    const room = maxWidth - 1 // reserve 1 col for the ellipsis
    content =
      firstLine.length > room ? firstLine.slice(0, room) + '…' : firstLine + '…'
  }
  return '    ' + pc.dim(pc.italic(content))
}

export function renderTaskList(tasks: TaskResult[]): string {
  const isTTY = process.stdout.isTTY ?? false
  const width = process.stdout.columns ?? 80
  const out: string[] = []
  for (const task of tasks) {
    out.push(renderTask(task))
    if (isTTY && task.notes) out.push(renderNotePreview(task.notes, width))
  }
  return out.join('\n')
}

// Render the Available block context-grouped: context-less items first, then for
// each distinct context (in first-appearance order) a green non-bold `@context`
// heading followed by the items under it (flat).
export function renderAvailableGrouped(tasks: TaskResult[]): string {
  const noCtx: TaskResult[] = []
  // Map from context name → tasks (preserves insertion order in JS Map).
  const byCtx = new Map<string, TaskResult[]>()
  for (const t of tasks) {
    if (t.contexts.length === 0) {
      noCtx.push(t)
    } else {
      // A task with multiple contexts appears once under each — but we want it under
      // its first context only (alphabetical), to avoid duplication. Keep it simple:
      // pick the first context (alphabetical, since serializer sorts alpha).
      const first = [...t.contexts].sort()[0]
      if (!byCtx.has(first)) byCtx.set(first, [])
      ;(byCtx.get(first) as TaskResult[]).push(t)
    }
  }
  const blocks: string[] = []
  if (noCtx.length > 0) blocks.push(renderTaskList(noCtx))
  for (const [ctx, items] of byCtx.entries()) {
    blocks.push(`${pc.green(`@${ctx}`)}\n\n${renderTaskList(items)}`)
  }
  return blocks.join('\n\n')
}

// Multi-lane listing: Available (context-grouped, no heading), then bold-headed
// Waiting:/Deferred: blocks. Used when the requested view spans more than one lane.
export function renderTaskListMulti(byLane: {
  available: TaskResult[]
  waiting: TaskResult[]
  deferred: TaskResult[]
}): string {
  const blocks: string[] = []
  if (byLane.available.length > 0) blocks.push(renderAvailableGrouped(byLane.available))
  if (byLane.waiting.length > 0) {
    blocks.push(`${pc.bold('Waiting:')}\n\n${renderTaskList(byLane.waiting)}`)
  }
  if (byLane.deferred.length > 0) {
    blocks.push(`${pc.bold('Deferred:')}\n\n${renderTaskList(byLane.deferred)}`)
  }
  return blocks.join('\n\n')
}

export function renderTaskShow(task: TaskResult): string {
  const head =
    [renderCheckbox(task.done), task.text]
      .concat(task.due ? [renderDueDate(task.due)] : [])
      .concat([renderRef(task.slug, task.index)])
      .join(' ')
  if (!task.notes) return head
  const body = task.notes
    .split('\n')
    .map((line) => '    ' + pc.dim(pc.italic(line)))
    .join('\n')
  return `${head}\n\n${body}`
}

export function renderMutationNote(result: MutationResult): string {
  const parts: string[] = []
  if (result.movedFrom) parts.push(`moved from '${result.movedFrom}'`)
  if (result.shift) {
    parts.push(
      `refs after #${result.shift.afterIndex} in '${result.shift.slug}' have shifted down — re-list before further edits`,
    )
  }
  if (parts.length === 0) return ''
  return '\n\n' + pc.dim(pc.italic(`Note: ${parts.join('; ')}.`))
}

export function renderMutation(result: MutationResult): string {
  return renderTask(result.task) + renderMutationNote(result)
}
