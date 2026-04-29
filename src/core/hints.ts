import type { Store } from './model.js'
import { dayDelta, daysSince, totalDeferredItems } from './render.js'

const STALE_WAITING_DAYS = 7
const LAPSED_DEADLINE_RECENCY_DAYS = 7

// Triggers ------------------------------------------------------------

export function recentLapsedDeadlines(s: Store, today: string): string[] {
  const out: string[] = []
  for (const i of s.items) {
    if (i.type !== 'deadline') continue
    if (i.status !== 'active') continue
    const delta = dayDelta(i.date, today)
    if (delta >= 0) continue
    const daysAgo = -delta
    if (daysAgo > LAPSED_DEADLINE_RECENCY_DAYS) continue
    out.push(
      `- "${i.title}" [${i.id}] deadline passed ${daysAgo} ${plural(daysAgo, 'day')} ago. ` +
        `Confirm with the user it's grokked, then \`todo drop ${i.id}\`.`,
    )
  }
  return out
}

export function stalledActiveProjects(s: Store, today: string): string[] {
  const out: string[] = []
  for (const p of s.lists) {
    if (p.type !== 'project') continue
    if (p.status !== 'active') continue
    const counts = countProjectChildren(s, p.id, today)
    if (!counts.hasAnyChildren) continue
    if (counts.activeActions > 0) continue
    out.push(
      `- "${p.title}" [${p.id}]: no active actions, ${counts.waiting} waiting, ` +
        `${counts.deadlines} ${plural(counts.deadlines, 'deadline')}. Either blocked on a waiting ` +
        `item, needs a next action defined, or consider \`todo defer ${p.id}\`.`,
    )
  }
  return out
}

export function staleWaiting(s: Store, today: string): string[] {
  const out: string[] = []
  for (const i of s.items) {
    if (i.type !== 'waiting') continue
    if (i.status !== 'active') continue
    const days = daysSince(i.created_at, today)
    if (days <= STALE_WAITING_DAYS) continue
    out.push(`- "${i.title}" [${i.id}] waiting ${days} days. Worth a follow-up?`)
  }
  return out
}

export function deferredCount(s: Store, today: string): string[] {
  const n = totalDeferredItems(s, today)
  if (n === 0) return []
  return [
    `- ${n} deferred ${plural(n, 'item')} hidden. \`todo list actions\` / \`todo list projects\` to inspect.`,
  ]
}

// Composer ------------------------------------------------------------

export function renderHints(s: Store, today: string, mode: 'dashboard' | 'review'): string {
  const sections = [
    recentLapsedDeadlines(s, today),
    stalledActiveProjects(s, today),
    staleWaiting(s, today),
    mode === 'dashboard' ? deferredCount(s, today) : [],
  ]
  const all = sections.flat()
  if (all.length === 0) return ''
  return all.join('\n') + '\n'
}

// Helpers -------------------------------------------------------------

function plural(n: number, singular: string): string {
  return n === 1 ? singular : `${singular}s`
}

function countProjectChildren(
  s: Store,
  projectId: string,
  today: string,
): { activeActions: number; waiting: number; deadlines: number; hasAnyChildren: boolean } {
  let activeActions = 0
  let waiting = 0
  let deadlines = 0
  let hasAnyChildren = false
  for (const i of s.items) {
    if (i.project !== projectId) continue
    if (i.type === 'memo') continue
    if (isTerminal(i.status)) continue
    hasAnyChildren = true
    if (i.type === 'action') {
      // Mirrors liveActions per-project: status=active, OR status=deferred with past-due start_at.
      if (
        i.status === 'active' ||
        (i.status === 'deferred' && i.start_at !== null && dayDelta(i.start_at, today) <= 0)
      ) {
        activeActions++
      }
    } else if (i.type === 'waiting' && i.status === 'active') {
      waiting++
    } else if (i.type === 'deadline' && i.status === 'active') {
      deadlines++
    }
  }
  return { activeActions, waiting, deadlines, hasAnyChildren }
}

function isTerminal(status: string): boolean {
  return status === 'completed' || status === 'dropped'
}
