import * as chrono from 'chrono-node'
import { InvalidDate } from './errors.js'

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/

function normalize(input: string): string {
  return input
    .trim()
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-zA-Z])/g, '$1 $2')
}

function formatLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function resolveDueInput(input: string, reference: Date = new Date()): string {
  const raw = input.trim()
  if (ISO_RE.test(raw)) return raw
  const parsed = chrono.parseDate(normalize(raw), reference, { forwardDate: true })
  if (!parsed) throw new InvalidDate(input)
  return formatLocal(parsed)
}
