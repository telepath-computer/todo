import pc from 'picocolors'
import type { Project } from '../core/project.js'
import type { TaskResult } from '../core/tasks.js'
import { orangeRed } from './atoms.js'
import { renderTaskListMulti } from './task.js'

export type ProjectSummary = { slug: string; title: string; notes?: string }

const PROJECT_GLYPH = '✳'

export function renderProject(project: ProjectSummary): string {
  const isTTY = process.stdout.isTTY ?? false
  const width = process.stdout.columns ?? 80

  const title = project.title === project.slug ? project.slug : project.title
  const refPlain = `[${project.slug}]`
  const leftPlain = `${PROJECT_GLYPH} ${title}`

  const styledLeft = `${orangeRed(PROJECT_GLYPH)} ${title}`
  const styledRight = pc.dim(refPlain)

  if (isTTY) {
    const pad = Math.max(1, width - leftPlain.length - refPlain.length)
    return styledLeft + ' '.repeat(pad) + styledRight
  }
  return `${styledLeft} ${styledRight}`
}

export function renderProjectList(projects: ProjectSummary[]): string {
  return projects.map(renderProject).join('\n')
}

export function renderProjectDetails(project: ProjectSummary): string {
  const titleValue =
    project.title === project.slug ? pc.dim('<none>') : project.title
  const lines = [
    `${pc.bold('id:')} ${project.slug}`,
    `${pc.bold('title:')} ${titleValue}`,
  ]
  if (project.notes && project.notes.length > 0) {
    lines.push(`${pc.bold('notes:')}\n${project.notes}`)
  } else {
    lines.push(`${pc.bold('notes:')} ${pc.dim('<none>')}`)
  }
  return lines.join('\n')
}

export function renderProjectHeading(headline: string, project: ProjectSummary): string {
  return `${headline}\n\n${renderProjectDetails(project)}`
}

export function renderProjectShow(project: Project): string {
  const isTTY = process.stdout.isTTY ?? false
  const width = process.stdout.columns ?? 80

  const title = project.title === project.slug ? project.slug : project.title
  const refPlain = `[${project.slug}]`
  const leftPlain = `${PROJECT_GLYPH} ${title}`
  const styledLeft = `${orangeRed(PROJECT_GLYPH)} ${pc.bold(title)}`
  const styledRef = pc.dim(refPlain)
  const header = isTTY
    ? styledLeft +
      ' '.repeat(Math.max(1, width - leftPlain.length - refPlain.length)) +
      styledRef
    : `${styledLeft} ${styledRef}`

  const parts: string[] = [header]

  // Notes (preamble) are rendered as italic prose, no heading.
  if (project.notes) {
    parts.push(pc.italic(project.notes))
  }

  // Surface every incomplete lane: Available items get the context-grouped layout
  // (context-less first, then green @context groups), then bold-headed Waiting:/Deferred:
  // blocks. Completed is archival and excluded.
  const byLane: { available: TaskResult[]; waiting: TaskResult[]; deferred: TaskResult[] } = {
    available: [],
    waiting: [],
    deferred: [],
  }
  project.tasks.forEach((t, i) => {
    if (t.lane === 'completed') return
    byLane[t.lane].push({
      slug: project.slug,
      index: i + 1,
      done: t.done,
      text: t.text,
      lane: t.lane,
      contexts: t.contexts.slice(),
      ...(t.due ? { due: t.due } : {}),
      ...(t.notes ? { notes: t.notes } : {}),
    })
  })
  const tasksBlock = renderTaskListMulti(byLane)
  if (tasksBlock.length > 0) parts.push(tasksBlock)

  return parts.join('\n\n')
}
