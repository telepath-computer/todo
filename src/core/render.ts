import {
  activeDeadlines,
  activeProjects,
  deferredActions,
  deferredProjects,
  findChildren,
  findList,
  liveActions,
  liveWaiting,
  projectActiveActions,
  projectDeadlines,
  projectDeferredActions,
  projectWaiting,
  type ActionItem,
  type DeadlineItem,
  type Item,
  type List,
  type ProjectList,
  type Store,
  type WaitingItem,
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

// Day-delta phrasing for the parenthesised note after each date field.

const dayWord = (n: number): string => (n === 1 ? 'day' : 'days')

function dueDelta(d: number): string {
  if (d < 0) return `overdue ${-d} ${dayWord(-d)}`
  if (d === 0) return 'today'
  if (d === 1) return 'tomorrow'
  return `in ${d} ${dayWord(d)}`
}

function deadlineDelta(d: number): string {
  if (d < 0) return `passed ${-d} ${dayWord(-d)} ago`
  if (d === 0) return 'today'
  if (d === 1) return 'tomorrow'
  return `in ${d} ${dayWord(d)}`
}

function startDelta(d: number): string {
  if (d < 0) return `revived ${-d} ${dayWord(-d)} ago`
  if (d === 0) return 'revives today'
  if (d === 1) return 'revives tomorrow'
  return `revives in ${d} ${dayWord(d)}`
}

function dateField(date: string, delta: string): string {
  return `${date} (${delta})`
}

function ageField(d: number): string {
  return `${d} ${dayWord(d)}`
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

// Collapse newlines for compact (dashboard / list / show-children) views
// so a multi-line note stays a clean single-line summary inside the
// YAML-ish key/value block.
function flattenNote(note: string): string {
  return note.replace(/\s*\n+\s*/g, ' ')
}

function compactNoteValue(note: string): string {
  return quote(truncateNote(flattenNote(note)))
}

// For single-entity show views: emit the full note un-truncated. Single-line
// notes stay quoted; multi-line notes use a YAML `|`-block scalar so the
// surrounding key/value block stays readable.
function showNoteField(note: string): [string, string] {
  if (!note.includes('\n')) return ['note', quote(note)]
  const indented = note.split('\n').map((l) => `  ${l}`).join('\n')
  return ['note', `|\n${indented}`]
}

// String quoting -------------------------------------------------------
// Free-form text values (title, note) are wrapped in double quotes so that
// embedded colons or whitespace can't be confused with the YAML-ish
// `key: value` shape. Backslashes and quotes inside are escaped.

export function quote(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

// Project ref ---------------------------------------------------------

function projectRef(s: Store, projectId: string | null): string | null {
  if (projectId === null) return null
  const p = findList(s, projectId)
  return p ? `${p.title} [${p.id}]` : `[${projectId}]`
}

// Field builders ------------------------------------------------------
//
// Each returns ordered (key, value) pairs.
//
// - 'dashboard'      → status implicit (hidden), project shown
// - 'list'           → status shown, project shown, closed_at shown if terminal
// - 'show-children'  → status implicit, project implicit (hidden)

type Ctx = 'dashboard' | 'list' | 'show-children'

function actionFields(a: ActionItem, s: Store, today: string, ctx: Ctx): [string, string][] {
  const f: [string, string][] = []
  f.push(['id', a.id])
  f.push(['title', quote(a.title)])
  if (ctx === 'list') f.push(['status', a.status])
  if (a.due !== null) f.push(['due', dateField(a.due, dueDelta(dayDelta(a.due, today)))])
  if (a.start_at !== null) f.push(['start', dateField(a.start_at, startDelta(dayDelta(a.start_at, today)))])
  if (ctx !== 'show-children') {
    const ref = projectRef(s, a.project)
    if (ref) f.push(['project', ref])
  }
  if (ctx === 'list' && a.closed_at !== null) f.push(['closed', a.closed_at])
  if (a.note !== null) f.push(['note', compactNoteValue(a.note)])
  return f
}

function waitingFields(w: WaitingItem, s: Store, today: string, ctx: Ctx): [string, string][] {
  const f: [string, string][] = []
  f.push(['id', w.id])
  f.push(['title', quote(w.title)])
  if (ctx === 'list') f.push(['status', w.status])
  if (ctx !== 'show-children') {
    const ref = projectRef(s, w.project)
    if (ref) f.push(['project', ref])
  }
  if (w.status === 'active') f.push(['age', ageField(daysSince(w.created_at, today))])
  if (ctx === 'list' && w.closed_at !== null) f.push(['closed', w.closed_at])
  if (w.note !== null) f.push(['note', compactNoteValue(w.note)])
  return f
}

function deadlineFields(d: DeadlineItem, s: Store, today: string, ctx: Ctx): [string, string][] {
  const f: [string, string][] = []
  f.push(['id', d.id])
  f.push(['title', quote(d.title)])
  if (ctx === 'list') f.push(['status', d.status])
  f.push(['date', dateField(d.date, deadlineDelta(dayDelta(d.date, today)))])
  if (ctx !== 'show-children') {
    const ref = projectRef(s, d.project)
    if (ref) f.push(['project', ref])
  }
  if (ctx === 'list' && d.closed_at !== null) f.push(['closed', d.closed_at])
  if (d.note !== null) f.push(['note', compactNoteValue(d.note)])
  return f
}

function projectFields(p: ProjectList, s: Store, ctx: Ctx): [string, string][] {
  const f: [string, string][] = []
  f.push(['id', p.id])
  f.push(['title', quote(p.title)])
  if (p.parent !== null && ctx !== 'show-children') {
    const ref = projectRef(s, p.parent)
    if (ref) f.push(['parent', ref])
  }
  if (ctx === 'list') f.push(['status', p.status])
  const counts = projectCounts(s, p.id)
  // Roll up direct children's counts so a parent's `waiting: 0` isn't
  // misleading when a sub-project has waiting items. Only roots have
  // children (depth strictly 1), so child blocks never show this.
  const sub = p.parent === null ? rollupChildCounts(s, p.id) : { actions: 0, waiting: 0, deadlines: 0 }
  f.push(['actions', countWithSub(counts.actions, sub.actions)])
  f.push(['waiting', countWithSub(counts.waiting, sub.waiting)])
  f.push(['deadlines', countWithSub(counts.deadlines, sub.deadlines)])
  if (ctx === 'list' && p.closed_at !== null) f.push(['closed', p.closed_at])
  if (p.note !== null) f.push(['note', compactNoteValue(p.note)])
  return f
}

function countWithSub(own: number, sub: number): string {
  if (sub === 0) return String(own)
  return `${own} (+${sub} in sub-projects)`
}

function projectCounts(s: Store, projectId: string): { actions: number; waiting: number; deadlines: number } {
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
  return { actions, waiting, deadlines }
}

function rollupChildCounts(s: Store, parentId: string): { actions: number; waiting: number; deadlines: number } {
  let actions = 0
  let waiting = 0
  let deadlines = 0
  for (const child of s.lists) {
    if (child.type !== 'project' || child.parent !== parentId) continue
    const c = projectCounts(s, child.id)
    actions += c.actions
    waiting += c.waiting
    deadlines += c.deadlines
  }
  return { actions, waiting, deadlines }
}

function isTerminal(s: string): boolean {
  return s === 'completed' || s === 'dropped'
}

function dispatchFields(item: Item, s: Store, today: string, ctx: Ctx): [string, string][] {
  if (item.type === 'action') return actionFields(item, s, today, ctx)
  if (item.type === 'waiting') return waitingFields(item, s, today, ctx)
  return deadlineFields(item, s, today, ctx)
}

// Block & section formatting -----------------------------------------

function itemBlock(fields: [string, string][]): string {
  return fields
    .map(([k, v], i) => (i === 0 ? `- ${k}: ${v}` : `  ${k}: ${v}`))
    .join('\n')
}

function entityBlock(fields: [string, string][]): string {
  // Single-entity show body: flush-left key/value lines, no leading dash.
  return fields.map(([k, v]) => `${k}: ${v}`).join('\n')
}

function section(heading: string, count: number, blocks: string[]): string {
  if (count === 0) return ''
  return `${heading} [${count}]:\n\n${blocks.join('\n\n')}`
}

// Top-level renderers ------------------------------------------------

const EMPTY_CONTEXT_PLACEHOLDER =
  "(empty — agent: store the user's current goals, priorities, focus, or pointers to relevant docs here. Not actions, deadlines, or projects; those have their own commands.)"

// Always-emitted YAML `|`-block scalar for the store's `meta.context`.
// Used both as the dashboard preamble and as the response to bare
// `todo context`. Always block-scalar (even single-line, even null) so
// the parser shape stays predictable regardless of body content.
export function renderContextBlock(s: Store): string {
  const body = s.meta.context ?? EMPTY_CONTEXT_PLACEHOLDER
  const indented = body.split('\n').map((l) => `  ${l}`).join('\n')
  return `CONTEXT: |\n${indented}`
}

export function renderDashboard(s: Store, today: string, hints?: string): string {
  const sections: string[] = []

  sections.push(renderContextBlock(s))

  const aa = liveActions(s, today)
  sections.push(
    section(
      'ACTIVE ACTIONS',
      aa.length,
      aa.map((a) => itemBlock(actionFields(a, s, today, 'dashboard'))),
    ),
  )

  const w = liveWaiting(s)
  sections.push(
    section(
      'WAITING',
      w.length,
      w.map((wi) => itemBlock(waitingFields(wi, s, today, 'dashboard'))),
    ),
  )

  const dl = activeDeadlines(s, today)
  sections.push(
    section(
      'DEADLINES',
      dl.length,
      dl.map((d) => itemBlock(deadlineFields(d, s, today, 'dashboard'))),
    ),
  )

  const ap = activeProjects(s)
  sections.push(
    section(
      'ACTIVE PROJECTS',
      ap.length,
      ap.map((p) => itemBlock(projectFields(p, s, 'dashboard'))),
    ),
  )

  if (hints && hints.length > 0) sections.push(`HINTS:\n\n${hints.trimEnd()}`)

  return sections.filter((x) => x.length > 0).join('\n\n')
}

export type ListType = 'actions' | 'projects' | 'deadlines' | 'waiting'

const LIST_HEADINGS: Record<ListType, string> = {
  actions: 'ACTIONS',
  projects: 'PROJECTS',
  deadlines: 'DEADLINES',
  waiting: 'WAITING',
}

export function renderList(s: Store, today: string, type: ListType): string {
  const heading = LIST_HEADINGS[type]
  if (type === 'projects') {
    if (s.lists.length === 0) return `${heading} [0]:`
    const blocks = s.lists.map((p) => itemBlock(projectFields(p, s, 'list')))
    return section(heading, s.lists.length, blocks)
  }
  const filtered: Item[] = s.items.filter((i) => {
    if (type === 'actions') return i.type === 'action'
    if (type === 'deadlines') return i.type === 'deadline'
    return i.type === 'waiting'
  })
  if (filtered.length === 0) return `${heading} [0]:`
  const blocks = filtered.map((i) => itemBlock(dispatchFields(i, s, today, 'list')))
  return section(heading, filtered.length, blocks)
}

export function renderShow(s: Store, today: string, entity: List | Item): string {
  if (entity.type === 'project') return renderShowProject(s, today, entity)
  return renderShowItem(s, today, entity)
}

function renderShowProject(s: Store, today: string, p: ProjectList): string {
  const fields: [string, string][] = []
  fields.push(['status', p.status])
  if (p.parent !== null) {
    const ref = projectRef(s, p.parent)
    if (ref) fields.push(['parent', ref])
  }
  if (p.closed_at !== null) fields.push(['closed', p.closed_at])
  fields.push(['created', p.created_at])
  if (p.note !== null) fields.push(showNoteField(p.note))

  const sections: string[] = []
  sections.push(`PROJECT: ${quote(p.title)} [${p.id}]\n\n${entityBlock(fields)}`)

  const aa = projectActiveActions(s, today, p.id)
  sections.push(
    section(
      'ACTIVE ACTIONS',
      aa.length,
      aa.map((a) => itemBlock(actionFields(a, s, today, 'show-children'))),
    ),
  )

  const da = projectDeferredActions(s, today, p.id)
  sections.push(
    section(
      'DEFERRED ACTIONS',
      da.length,
      da.map((a) => itemBlock(actionFields(a, s, today, 'show-children'))),
    ),
  )

  const w = projectWaiting(s, p.id)
  sections.push(
    section(
      'WAITING',
      w.length,
      w.map((wi) => itemBlock(waitingFields(wi, s, today, 'show-children'))),
    ),
  )

  const dl = projectDeadlines(s, today, p.id)
  sections.push(
    section(
      'DEADLINES',
      dl.length,
      dl.map((d) => itemBlock(deadlineFields(d, s, today, 'show-children'))),
    ),
  )

  const subs = findChildren(s, p.id)
  sections.push(
    section(
      'SUB-PROJECTS',
      subs.length,
      subs.map((sp) => itemBlock(projectFields(sp, s, 'show-children'))),
    ),
  )

  return sections.filter((x) => x.length > 0).join('\n\n')
}

function renderShowItem(s: Store, today: string, i: Item): string {
  const typeName = i.type.toUpperCase()
  // Use 'list' context so status, project, closed_at are all included.
  const fields = dispatchFields(i, s, today, 'list')
  // Drop id/title — they're in the header line.
  const body = fields.filter(([k]) => k !== 'id' && k !== 'title')
  body.push(['created', i.created_at])
  // Replace the compact note (from 'list' ctx) with the full-text show form.
  if (i.note !== null) {
    const idx = body.findIndex(([k]) => k === 'note')
    const full = showNoteField(i.note)
    if (idx >= 0) body[idx] = full
    else body.push(full)
  }
  return `${typeName}: ${quote(i.title)} [${i.id}]\n\n${entityBlock(body)}`
}

// Hints support ------------------------------------------------------

export function totalDeferredItems(s: Store, today: string): number {
  return deferredActions(s, today).length + deferredProjects(s).length
}
