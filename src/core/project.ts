import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  InvalidSlug,
  MalformedProject,
  NothingToEdit,
  ProjectAlreadyExists,
  ProjectNotFound,
} from './errors.js'
import type { Vault } from './vault.js'

const SLUG_RE = /^[a-z0-9][a-z0-9.-]*$/
const HEADING_RE = /^#{1,2}\s/
const TASK_LINE_RE = /^- \[( |x)\] (.+)$/
// Trailing tokens stripped from the right of a task line:
//   !YYYY-MM-DD  → due (at most one)
//   @<string>    → context (zero or more; <string> is any non-whitespace)
const DUE_TOKEN_RE = /^!(\d{4}-\d{2}-\d{2})$/
const CONTEXT_TOKEN_RE = /^@(\S+)$/
const INDENT_RE = /^(?:\t| {2,})/

export type ActiveLane = 'available' | 'waiting' | 'deferred'
export type Lane = ActiveLane | 'completed'

export const LANES: readonly ActiveLane[] = ['available', 'waiting', 'deferred'] as const

const LANE_HEADINGS: Record<ActiveLane, string> = {
  available: '## Available',
  waiting: '## Waiting',
  deferred: '## Deferred',
}

const LANE_HEADING_RE: Record<ActiveLane, RegExp> = {
  available: /^##\s+Available\s*$/,
  waiting: /^##\s+Waiting\s*$/,
  deferred: /^##\s+Deferred\s*$/,
}

const COMPLETED_HEADING_RE = /^##\s+Completed\s*$/
const DATE_LABEL_RE = /^(\d{4}-\d{2}-\d{2}):\s*$/

function matchLaneHeading(line: string): ActiveLane | null {
  for (const lane of LANES) {
    if (LANE_HEADING_RE[lane].test(line)) return lane
  }
  return null
}

export function sanitizeTaskNote(s: string): string {
  // Escape lone `*` so it doesn't break our outer italic wrap.
  // Leave `**` (bold) and longer runs untouched.
  return s.replace(/(?<!\*)\*(?!\*)/g, '\\*')
}

function unescapeTaskNote(s: string): string {
  return s.replace(/\\\*/g, '*')
}

export type Task = {
  done: boolean
  text: string
  lane: Lane
  contexts: string[]
  due?: string
  notes?: string
  completedAt?: string // YYYY-MM-DD; present iff lane === 'completed'
}

export function parseTaskLine(line: string): Omit<Task, 'lane'> | null {
  const m = line.match(TASK_LINE_RE)
  if (!m) return null
  const done = m[1] === 'x'
  // Strip trailing `!date` and `@context` tokens, in any order, from the end of the text.
  const tokens = m[2].split(/\s+/)
  let due: string | undefined
  const contexts: string[] = []
  while (tokens.length > 0) {
    const last = tokens[tokens.length - 1]
    const dueMatch = last.match(DUE_TOKEN_RE)
    if (dueMatch && due === undefined) {
      due = dueMatch[1]
      tokens.pop()
      continue
    }
    const ctxMatch = last.match(CONTEXT_TOKEN_RE)
    if (ctxMatch) {
      contexts.unshift(ctxMatch[1])
      tokens.pop()
      continue
    }
    break
  }
  const text = tokens.join(' ')
  const result: Omit<Task, 'lane'> = { done, text, contexts }
  if (due) result.due = due
  return result
}

export function serializeTaskLine(
  task: Pick<Task, 'done' | 'text' | 'due'> & { contexts?: string[] },
): string {
  const checkbox = task.done ? 'x' : ' '
  const sortedContexts = (task.contexts ?? []).slice().sort()
  const ctxSuffix = sortedContexts.map((c) => ` @${c}`).join('')
  const dueSuffix = task.due ? ` !${task.due}` : ''
  return `- [${checkbox}] ${task.text}${ctxSuffix}${dueSuffix}`
}

function serializeTaskBlock(task: Task): string {
  const lines = [serializeTaskLine({
    done: task.done,
    text: task.text,
    contexts: task.contexts,
    ...(task.due ? { due: task.due } : {}),
  })]
  if (task.notes) {
    const wrapped = `*${task.notes}*`
    for (const line of wrapped.split('\n')) {
      lines.push(line.length > 0 ? `\t${line}` : '')
    }
  }
  return lines.join('\n')
}

function parseLaneSection(
  sectionLines: string[],
  lane: Lane,
  completedAt?: string,
): Task[] {
  const tasks: Task[] = []
  let current: Task | null = null
  let noteLines: string[] = []
  const flush = () => {
    if (current) {
      while (noteLines.length > 0 && noteLines[0] === '') noteLines.shift()
      while (noteLines.length > 0 && noteLines[noteLines.length - 1] === '') noteLines.pop()
      if (noteLines.length > 0) {
        const first = noteLines[0]
        const last = noteLines[noteLines.length - 1]
        const canStrip =
          first.startsWith('*') &&
          last.endsWith('*') &&
          (noteLines.length > 1 || first.length >= 2)
        if (canStrip) {
          noteLines[0] = first.slice(1)
          const lastIdx = noteLines.length - 1
          noteLines[lastIdx] = noteLines[lastIdx].slice(0, -1)
        }
        current.notes = unescapeTaskNote(noteLines.join('\n'))
      }
      tasks.push(current)
    }
    current = null
    noteLines = []
  }
  for (const line of sectionLines) {
    const parsed = parseTaskLine(line)
    if (parsed) {
      flush()
      current = { ...parsed, lane, ...(completedAt ? { completedAt } : {}) }
    } else if (current) {
      if (line === '') {
        noteLines.push('')
      } else if (INDENT_RE.test(line)) {
        noteLines.push(line.replace(INDENT_RE, ''))
      }
    }
  }
  flush()
  return tasks
}

function parseCompletedSection(sectionLines: string[]): Task[] {
  // Walk the body of `## Completed`, splitting on `YYYY-MM-DD:` date labels.
  // Items appear under a label and inherit its date as `completedAt`.
  const tasks: Task[] = []
  let currentDate: string | undefined
  let buffer: string[] = []
  const flush = () => {
    if (currentDate && buffer.length > 0) {
      tasks.push(...parseLaneSection(buffer, 'completed', currentDate))
    }
    buffer = []
  }
  for (const line of sectionLines) {
    const labelMatch = line.match(DATE_LABEL_RE)
    if (labelMatch) {
      flush()
      currentDate = labelMatch[1]
      continue
    }
    if (currentDate) buffer.push(line)
  }
  flush()
  return tasks
}

export type Project = {
  slug: string
  title: string
  tasks: Task[] // flat, document order: available → waiting → deferred
  notes?: string // preamble prose: markdown between frontmatter and the first lane heading
  // Round-trip state for opaque regions outside managed sections:
  frontmatter: string // raw frontmatter block including --- delimiters; '' if none
  tail: string // text after the last lane section, preserved verbatim
}

// Preamble escapes any `#` at the start of a line to `\#` on write so user prose
// can't accidentally open a section. Reverse on read.
const PREAMBLE_HASH_ESCAPE_RE = /^\\#/gm
const PREAMBLE_HASH_RE = /^#/gm

function unescapePreamble(s: string): string {
  return s.replace(PREAMBLE_HASH_ESCAPE_RE, '#')
}

function escapePreamble(s: string): string {
  return s.replace(PREAMBLE_HASH_RE, '\\#')
}

export function validateSlug(slug: string): void {
  if (!SLUG_RE.test(slug) || slug.includes('#')) {
    throw new InvalidSlug(slug)
  }
}

function projectPath(vault: Vault, slug: string): string {
  return join(vault.dir, `${slug}.md`)
}

export function listProjectSlugs(vault: Vault): string[] {
  if (!existsSync(vault.dir)) return []
  return readdirSync(vault.dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.slice(0, -3))
    .filter((s) => SLUG_RE.test(s) && !s.includes('#'))
    .sort()
}

function extractTitle(content: string, fallback: string): string {
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!fmMatch) return fallback
  const fm = fmMatch[1]
  const titleMatch = fm.match(/^title:\s*(.*)$/m)
  if (!titleMatch) return fallback
  const raw = titleMatch[1].trim()
  if (raw.startsWith('"')) {
    try {
      return JSON.parse(raw)
    } catch {
      return raw
    }
  }
  if (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2) {
    return raw.slice(1, -1)
  }
  return raw
}

export function parseProject(slug: string, content: string): Project {
  const title = extractTitle(content, slug)

  // Split off the frontmatter block (including delimiters and trailing newline).
  let frontmatter = ''
  let body = content
  const fmMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/)
  if (fmMatch) {
    frontmatter = fmMatch[0]
    body = content.slice(fmMatch[0].length)
  }

  const bodyLines = body.split('\n')

  // Scan for lane section headings. Record the first occurrence of each.
  const laneStartIdx: Partial<Record<Lane, number>> = {}
  let firstLaneIdx = -1
  for (let i = 0; i < bodyLines.length; i++) {
    const lane = matchLaneHeading(bodyLines[i])
    if (lane && laneStartIdx[lane] === undefined) {
      laneStartIdx[lane] = i
      if (firstLaneIdx === -1) firstLaneIdx = i
    }
  }
  if (firstLaneIdx === -1) {
    throw new MalformedProject(slug, "missing '## Available' section")
  }

  // For each lane present, find where its section ends (next heading at depth ≤ 2).
  const laneEndIdx: Partial<Record<Lane, number>> = {}
  for (const lane of LANES) {
    const start = laneStartIdx[lane]
    if (start === undefined) continue
    let end = bodyLines.length
    for (let i = start + 1; i < bodyLines.length; i++) {
      if (HEADING_RE.test(bodyLines[i])) {
        end = i
        break
      }
    }
    laneEndIdx[lane] = end
  }

  const tasks: Task[] = []
  for (const lane of LANES) {
    const start = laneStartIdx[lane]
    if (start === undefined) continue
    const end = laneEndIdx[lane] as number
    tasks.push(...parseLaneSection(bodyLines.slice(start + 1, end), lane))
  }

  const lanesEnd = Math.max(
    ...LANES.map((l) => (laneStartIdx[l] !== undefined ? (laneEndIdx[l] as number) : -1)),
  )

  // Look for a `## Completed` section after the active lanes.
  let completedStart = -1
  for (let i = lanesEnd; i < bodyLines.length; i++) {
    if (COMPLETED_HEADING_RE.test(bodyLines[i])) {
      completedStart = i
      break
    }
  }

  let completedEnd = lanesEnd
  if (completedStart !== -1) {
    completedEnd = bodyLines.length
    for (let i = completedStart + 1; i < bodyLines.length; i++) {
      if (HEADING_RE.test(bodyLines[i])) {
        completedEnd = i
        break
      }
    }
    tasks.push(...parseCompletedSection(bodyLines.slice(completedStart + 1, completedEnd)))
  }

  // Preamble = lines between frontmatter end and first lane heading.
  // Trim leading/trailing blank lines, unescape \# → #.
  const preambleRaw = bodyLines.slice(0, firstLaneIdx).join('\n').replace(/^\n+|\n+$/g, '')
  const notes = preambleRaw.length > 0 ? unescapePreamble(preambleRaw) : undefined

  // Tail starts after the last managed section (Completed if present, else last active lane).
  const managedEnd = completedStart !== -1 ? completedEnd : lanesEnd
  const tail = managedEnd < bodyLines.length ? bodyLines.slice(managedEnd).join('\n') : ''

  return { slug, title, tasks, notes, frontmatter, tail }
}

function emitLaneBlock(heading: string, tasks: Task[]): string {
  if (tasks.length === 0) return ''
  return `${heading}\n\n${tasks.map(serializeTaskBlock).join('\n')}\n`
}

function emitCompletedBlock(tasks: Task[]): string {
  if (tasks.length === 0) return ''
  // Group by completedAt date.
  const byDate = new Map<string, Task[]>()
  for (const t of tasks) {
    const d = t.completedAt ?? ''
    if (!byDate.has(d)) byDate.set(d, [])
    ;(byDate.get(d) as Task[]).push(t)
  }
  // Sort dates newest-first (descending lexicographic on ISO strings).
  const sortedDates = Array.from(byDate.keys()).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
  const dateBlocks = sortedDates.map((date) => {
    const items = byDate.get(date) as Task[]
    return `${date}:\n\n${items.map(serializeTaskBlock).join('\n')}\n`
  })
  return `## Completed\n\n${dateBlocks.join('\n')}`
}

export function serializeProject(project: Project): string {
  const byLane: Record<ActiveLane, Task[]> = { available: [], waiting: [], deferred: [] }
  const completed: Task[] = []
  for (const t of project.tasks) {
    if (t.lane === 'completed') completed.push(t)
    else byLane[t.lane].push(t)
  }

  // ## Available is always emitted (heading-only when empty).
  const availableBlock = byLane.available.length > 0
    ? emitLaneBlock(LANE_HEADINGS.available, byLane.available)
    : `${LANE_HEADINGS.available}\n`
  const waitingBlock = emitLaneBlock(LANE_HEADINGS.waiting, byLane.waiting)
  const deferredBlock = emitLaneBlock(LANE_HEADINGS.deferred, byLane.deferred)
  const completedBlock = emitCompletedBlock(completed)

  const laneBlocks = [availableBlock, waitingBlock, deferredBlock, completedBlock].filter(
    (b) => b.length > 0,
  )
  const lanesText = laneBlocks.join('\n')

  // Frontmatter (verbatim, ensure trailing newline so a blank line follows).
  let out = project.frontmatter
  if (out.length > 0 && !out.endsWith('\n')) out += '\n'

  // Preamble notes — escaped so user prose can't accidentally open a section.
  const trimmedNotes = project.notes?.trim() ?? ''
  if (trimmedNotes.length > 0) {
    // Blank line between frontmatter and notes (if frontmatter present).
    if (out.length > 0 && !out.endsWith('\n\n')) out += '\n'
    out += escapePreamble(trimmedNotes) + '\n'
    // Blank line between notes and lanes.
    out += '\n'
  } else if (out.length > 0 && !out.endsWith('\n\n')) {
    // No notes: still need a blank line between frontmatter and lanes.
    out += '\n'
  }

  out += lanesText

  if (project.tail.length > 0) {
    if (!out.endsWith('\n\n')) {
      if (!out.endsWith('\n')) out += '\n'
      out += '\n'
    }
    out += project.tail.replace(/^\n+/, '')
  }

  if (!out.endsWith('\n')) out += '\n'
  return out
}

export function readProject(vault: Vault, slug: string): Project {
  validateSlug(slug)
  const path = projectPath(vault, slug)
  if (!existsSync(path)) throw new ProjectNotFound(slug)
  const content = readFileSync(path, 'utf8')
  return parseProject(slug, content)
}

export function writeProject(vault: Vault, project: Project): void {
  mkdirSync(vault.dir, { recursive: true })
  writeFileSync(projectPath(vault, project.slug), serializeProject(project))
}

export function createProject(
  vault: Vault,
  slug: string,
  title?: string,
  notes?: string,
): Project {
  validateSlug(slug)
  const path = projectPath(vault, slug)
  if (existsSync(path)) throw new ProjectAlreadyExists(slug)
  const actualTitle = title ?? slug
  const titleValue = JSON.stringify(actualTitle)
  const project: Project = {
    slug,
    title: actualTitle,
    tasks: [],
    frontmatter: `---\ntitle: ${titleValue}\n---\n`,
    tail: '',
    ...(notes && notes.trim().length > 0 ? { notes: notes.trim() } : {}),
  }
  mkdirSync(vault.dir, { recursive: true })
  writeFileSync(path, serializeProject(project))
  return parseProject(slug, readFileSync(path, 'utf8'))
}

export function removeProject(vault: Vault, slug: string): Project {
  const project = readProject(vault, slug)
  rmSync(projectPath(vault, slug))
  return project
}

function setFrontmatterTitle(frontmatter: string, newTitle: string): string {
  const titleLine = `title: ${JSON.stringify(newTitle)}`
  const fmRe = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?$/
  const fmMatch = frontmatter.match(fmRe)
  if (fmMatch) {
    const fm = fmMatch[1]
    if (/^title:\s*.*$/m.test(fm)) {
      return frontmatter.replace(/^title:\s*.*$/m, titleLine)
    }
    const updatedFm = fm.length > 0 ? `${fm}\n${titleLine}` : titleLine
    return `---\n${updatedFm}\n---\n`
  }
  // No frontmatter present — synthesize one.
  return `---\n${titleLine}\n---\n`
}

export type ProjectEdit = { title?: string; notes?: string }

export function editProject(vault: Vault, slug: string, updates: ProjectEdit): Project {
  if (updates.title === undefined && updates.notes === undefined) {
    throw new NothingToEdit()
  }
  const project = readProject(vault, slug)
  if (updates.title !== undefined) {
    project.frontmatter = setFrontmatterTitle(project.frontmatter, updates.title)
    project.title = updates.title
  }
  if (updates.notes !== undefined) {
    project.notes = updates.notes.trim().length > 0 ? updates.notes.trim() : undefined
  }
  writeProject(vault, project)
  return project
}
