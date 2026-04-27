import {
  activeDeadlines,
  activeProjects,
  deferredActions,
  deferredProjects,
  findList,
  liveActions,
  liveWaiting,
  projectActiveActions,
  projectDeadlines,
  projectDeferredActions,
  projectWaiting,
  type Item,
  type List,
  type ProjectList,
  type Store,
} from './model.js'

// Date arithmetic ------------------------------------------------------

export function dayDelta(date: string, today: string): number {
  return Math.round(ymdToMs(date) - ymdToMs(today))
}

function ymdToMs(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d).getTime() / 86400000
}

export function daysSince(createdIso: string, today: string): number {
  const c = new Date(createdIso)
  const createdDay = new Date(c.getFullYear(), c.getMonth(), c.getDate()).getTime() / 86400000
  return Math.round(ymdToMs(today) - createdDay)
}

// Modifiers ------------------------------------------------------------

const days = (n: number): string => (n === 1 ? 'day' : 'days')

export function dueModifier(due: string, today: string): string {
  const d = dayDelta(due, today)
  if (d < 0) return `due ${due} (overdue ${-d} ${days(-d)})`
  if (d === 0) return `due ${due} (today)`
  if (d === 1) return `due ${due} (tomorrow)`
  return `due ${due} (in ${d} days)`
}

export function deadlineModifier(date: string, today: string): string {
  const d = dayDelta(date, today)
  if (d < 0) return `date ${date} (passed ${-d} ${days(-d)} ago)`
  if (d === 0) return `date ${date} (today)`
  if (d === 1) return `date ${date} (tomorrow)`
  return `date ${date} (in ${d} days)`
}

export function startModifier(start: string, today: string): string {
  const d = dayDelta(start, today)
  if (d < 0) return `start ${start} (revived ${-d} ${days(-d)} ago)`
  if (d === 0) return `start ${start} (revives today)`
  if (d === 1) return `start ${start} (revives tomorrow)`
  return `start ${start} (revives in ${d} days)`
}

// Note truncation ------------------------------------------------------

const MAX_NOTE_LEN = 150

export function truncateNote(note: string, maxLen = MAX_NOTE_LEN): string {
  if (note.length <= maxLen) return note
  const window = note.slice(0, maxLen)
  const cut = window.lastIndexOf(' ')
  if (cut > maxLen - 30) return window.slice(0, cut) + '…'
  return window + '…'
}

function noteModifier(note: string | null): string | null {
  if (note === null) return null
  return `note: "${truncateNote(note)}"`
}

function projectModifier(s: Store, projectId: string | null): string | null {
  if (projectId === null) return null
  const p = findList(s, projectId)
  if (!p) return `project ${projectId}`
  return `project ${p.title} (${p.id})`
}

// Item / project lines -------------------------------------------------

export type LineOpts = { listMode?: boolean }

export function renderItemLine(i: Item, s: Store, today: string, opts: LineOpts = {}): string {
  const mods: string[] = []

  if (i.type === 'action') {
    if (i.due !== null) mods.push(dueModifier(i.due, today))
    if (i.start_at !== null) mods.push(startModifier(i.start_at, today))
  } else if (i.type === 'deadline') {
    mods.push(deadlineModifier(i.date, today))
  }

  const proj = projectModifier(s, i.project)
  if (proj) mods.push(proj)

  if (i.type === 'waiting' && i.status === 'active') {
    mods.push(`waiting ${daysSince(i.created_at, today)} days`)
  }

  if (opts.listMode) {
    mods.push(`status ${i.status}`)
    if (i.closed_at !== null) mods.push(`closed ${i.closed_at}`)
  }

  const note = noteModifier(i.note)
  if (note) mods.push(note)

  return formatLine(i.id, i.title, mods)
}

export function renderProjectLine(p: ProjectList, s: Store, opts: LineOpts = {}): string {
  const counts = projectCounts(s, p.id)
  const mods: string[] = []
  if (counts) mods.push(counts)
  if (opts.listMode) {
    mods.push(`status ${p.status}`)
    if (p.closed_at !== null) mods.push(`closed ${p.closed_at}`)
  }
  const note = noteModifier(p.note)
  if (note) mods.push(note)
  return formatLine(p.id, p.title, mods)
}

function projectCounts(s: Store, projectId: string): string | null {
  let actions = 0
  let waiting = 0
  let deadlines = 0
  for (const i of s.items) {
    if (i.project !== projectId) continue
    if (isTerminal(i.status)) continue
    if (i.type === 'action') actions++
    else if (i.type === 'waiting') waiting++
    else if (i.type === 'deadline') deadlines++
  }
  const parts: string[] = []
  if (actions > 0) parts.push(`${actions} ${actions === 1 ? 'action' : 'actions'}`)
  if (waiting > 0) parts.push(`${waiting} waiting`)
  if (deadlines > 0) parts.push(`${deadlines} ${deadlines === 1 ? 'deadline' : 'deadlines'}`)
  return parts.length === 0 ? null : parts.join(', ')
}

function isTerminal(s: string): boolean {
  return s === 'completed' || s === 'dropped'
}

function formatLine(id: string, title: string, mods: string[]): string {
  if (mods.length === 0) return `- (${id}) ${title}`
  return `- (${id}) ${title} — ${mods.join(', ')}`
}

// Block-level renderers ------------------------------------------------

function bucket(heading: string, lines: string[]): string {
  if (lines.length === 0) return ''
  return `# ${heading} (${lines.length})\n${lines.join('\n')}\n`
}

function subBucket(heading: string, lines: string[]): string {
  if (lines.length === 0) return ''
  return `## ${heading} (${lines.length})\n${lines.join('\n')}\n`
}

export function renderDashboard(s: Store, today: string, hints?: string): string {
  const sections: string[] = []
  sections.push(bucket('Active actions', liveActions(s, today).map((a) => renderItemLine(a, s, today))))
  sections.push(bucket('Waiting', liveWaiting(s).map((w) => renderItemLine(w, s, today))))
  sections.push(bucket('Deadlines', activeDeadlines(s, today).map((d) => renderItemLine(d, s, today))))
  sections.push(bucket('Active projects', activeProjects(s).map((p) => renderProjectLine(p, s))))
  if (hints && hints.length > 0) sections.push(`# Hints\n${hints}\n`)
  return sections.filter((x) => x.length > 0).join('\n').replace(/\n$/, '')
}

export type ListType = 'actions' | 'projects' | 'deadlines' | 'waiting'

export function renderList(s: Store, today: string, type: ListType): string {
  const heading = type.charAt(0).toUpperCase() + type.slice(1)
  let lines: string[]
  if (type === 'projects') {
    lines = s.lists.map((p) => renderProjectLine(p, s, { listMode: true }))
  } else {
    const filtered: Item[] = s.items.filter((i) => {
      if (type === 'actions') return i.type === 'action'
      if (type === 'deadlines') return i.type === 'deadline'
      if (type === 'waiting') return i.type === 'waiting'
      return false
    })
    lines = filtered.map((i) => renderItemLine(i, s, today, { listMode: true }))
  }
  if (lines.length === 0) return `# ${heading} (0)`
  return `# ${heading} (${lines.length})\n${lines.join('\n')}`
}

export function renderShow(s: Store, today: string, entity: List | Item, hints?: string): string {
  if (entity.type === 'project') return renderShowProject(s, today, entity, hints)
  return renderShowItem(s, today, entity)
}

function renderShowProject(s: Store, today: string, p: ProjectList, hints?: string): string {
  const header = [`# Project — ${p.title} (${p.id})`]
  header.push(`- Status: ${p.status}`)
  if (p.closed_at !== null) header.push(`- Closed: ${p.closed_at}`)
  header.push(`- Created: ${p.created_at}`)
  header.push(`- Note: ${p.note ?? '(none)'}`)

  const sections: string[] = [header.join('\n')]
  sections.push(subBucket('Active actions', projectActiveActions(s, today, p.id).map((a) => renderItemLine(a, s, today))))
  sections.push(subBucket('Deferred actions', projectDeferredActions(s, today, p.id).map((a) => renderItemLine(a, s, today))))
  sections.push(subBucket('Waiting', projectWaiting(s, p.id).map((w) => renderItemLine(w, s, today))))
  sections.push(subBucket('Deadlines', projectDeadlines(s, today, p.id).map((d) => renderItemLine(d, s, today))))
  if (hints && hints.length > 0) sections.push(`## Hints\n${hints}\n`)
  return sections.filter((x) => x.length > 0).join('\n').replace(/\n$/, '')
}

function renderShowItem(s: Store, today: string, i: Item): string {
  const typeName = i.type.charAt(0).toUpperCase() + i.type.slice(1)
  const lines = [`# ${typeName} — ${i.title} (${i.id})`]
  lines.push(`- Status: ${i.status}`)

  if (i.type === 'action') {
    if (i.due !== null) lines.push(`- Due: ${stripParens(dueModifier(i.due, today))}`)
    else lines.push(`- Due: (none)`)
    if (i.start_at !== null) lines.push(`- Start: ${stripParens(startModifier(i.start_at, today))}`)
  } else if (i.type === 'deadline') {
    lines.push(`- Date: ${stripParens(deadlineModifier(i.date, today))}`)
  }

  if (i.type === 'waiting' && i.status === 'active') {
    lines.push(`- Waiting: ${daysSince(i.created_at, today)} days`)
  }

  if (i.project !== null) {
    const p = findList(s, i.project)
    lines.push(`- Project: ${p ? `${p.title} (${p.id})` : i.project}`)
  } else {
    lines.push(`- Project: (none)`)
  }

  if (i.closed_at !== null) lines.push(`- Closed: ${i.closed_at}`)
  lines.push(`- Created: ${i.created_at}`)
  lines.push(`- Note: ${i.note ?? '(none)'}`)
  return lines.join('\n')
}

// `due 2026-04-28 (in 1 day)` → `2026-04-28 (in 1 day)`. Used to render a
// modifier in a key/value position where the leading word is redundant.
function stripParens(modifier: string): string {
  const idx = modifier.indexOf(' ')
  return idx === -1 ? modifier : modifier.slice(idx + 1)
}

// Hints support: deferred totals used by the long-tail-deferred hint and
// elsewhere. Kept here because it's display-shape, not model state.

export function totalDeferredItems(s: Store, today: string): number {
  return deferredActions(s, today).length + deferredProjects(s).length
}
