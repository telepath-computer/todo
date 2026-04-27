import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { requireFutureDate, resolveDueInput, todayLocal } from '../src/core/dates.js'
import { InvalidArgument, InvalidDate } from '../src/core/errors.js'

function ymd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

describe('dates.resolveDueInput', () => {
  it('passes bare YYYY-MM-DD through unchanged', () => {
    assert.equal(resolveDueInput('2026-05-01'), '2026-05-01')
  })

  it('resolves "today" to today in local time', () => {
    const ref = new Date(2026, 4, 15) // May 15, 2026 local
    assert.equal(resolveDueInput('today', ref), '2026-05-15')
  })

  it('resolves "tomorrow" to the next local day', () => {
    const ref = new Date(2026, 4, 15)
    assert.equal(resolveDueInput('tomorrow', ref), '2026-05-16')
  })

  it('resolves "may 1" with forwardDate to next May 1', () => {
    const ref = new Date(2026, 5, 15) // June 15, 2026 — past May 1
    assert.equal(resolveDueInput('may 1', ref), '2027-05-01')
  })

  it('resolves the shorthand "may1" by normalising spacing', () => {
    const ref = new Date(2026, 0, 15) // January 15, 2026 — before May 1
    assert.equal(resolveDueInput('may1', ref), '2026-05-01')
  })

  it('resolves "next friday" to a future Friday', () => {
    const ref = new Date(2026, 4, 15) // Friday May 15, 2026
    const out = resolveDueInput('next friday', ref)
    const outDate = new Date(`${out}T00:00:00`)
    assert.equal(outDate.getDay(), 5, 'resolved date is a Friday')
    assert.ok(outDate.getTime() > ref.getTime(), 'resolved date is after reference')
  })

  it('resolves "in 3 days" to reference + 3 days', () => {
    const ref = new Date(2026, 4, 15)
    const expected = ymd(new Date(2026, 4, 18))
    assert.equal(resolveDueInput('in 3 days', ref), expected)
  })

  it('throws InvalidDate for gibberish', () => {
    assert.throws(() => resolveDueInput('asdfghjkl'), InvalidDate)
  })
})

describe('dates.todayLocal', () => {
  it('returns YYYY-MM-DD', () => {
    assert.match(todayLocal(), /^\d{4}-\d{2}-\d{2}$/)
  })

  it('formats the reference date in local time', () => {
    const ref = new Date(2026, 4, 15)
    assert.equal(todayLocal(ref), '2026-05-15')
  })
})

describe('dates.requireFutureDate', () => {
  it('accepts a future date', () => {
    const ref = new Date(2026, 4, 15)
    assert.equal(requireFutureDate('2026-06-01', ref), '2026-06-01')
    assert.equal(requireFutureDate('tomorrow', ref), '2026-05-16')
  })

  it('rejects today', () => {
    const ref = new Date(2026, 4, 15)
    assert.throws(() => requireFutureDate('today', ref), InvalidArgument)
    assert.throws(() => requireFutureDate('2026-05-15', ref), InvalidArgument)
  })

  it('rejects past dates', () => {
    const ref = new Date(2026, 4, 15)
    assert.throws(() => requireFutureDate('2026-01-01', ref), InvalidArgument)
    assert.throws(() => requireFutureDate('yesterday', ref), InvalidArgument)
  })

  it('rejects gibberish with InvalidDate (delegated)', () => {
    assert.throws(() => requireFutureDate('asdfghjkl'), InvalidDate)
  })
})
