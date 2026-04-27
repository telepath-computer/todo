import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatRef, parseRef } from '../src/core/ref.js'
import { InvalidRef } from '../src/core/errors.js'

describe('ref.parseRef', () => {
  it('parses simple slug and index', () => {
    assert.deepEqual(parseRef('foo#1'), { slug: 'foo', index: 1 })
  })

  it('parses slug containing hyphens and dots', () => {
    assert.deepEqual(parseRef('launch-telepath-v0.3#42'), {
      slug: 'launch-telepath-v0.3',
      index: 42,
    })
  })

  it('rejects ref without hash', () => {
    assert.throws(() => parseRef('foo'), InvalidRef)
  })

  it('rejects empty slug', () => {
    assert.throws(() => parseRef('#1'), InvalidRef)
  })

  it('rejects empty index', () => {
    assert.throws(() => parseRef('foo#'), InvalidRef)
  })

  it('rejects non-numeric index', () => {
    assert.throws(() => parseRef('foo#abc'), InvalidRef)
  })

  it('rejects zero index', () => {
    assert.throws(() => parseRef('foo#0'), InvalidRef)
  })

  it('rejects negative index', () => {
    assert.throws(() => parseRef('foo#-1'), InvalidRef)
  })
})

describe('ref.formatRef', () => {
  it('joins slug and index with #', () => {
    assert.equal(formatRef('foo', 1), 'foo#1')
  })

  it('round-trips with parseRef', () => {
    const ref = formatRef('launch-v0.3', 42)
    assert.deepEqual(parseRef(ref), { slug: 'launch-v0.3', index: 42 })
  })
})
