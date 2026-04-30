import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { DoError } from '../src/core/errors.js'
import { EMPTY_STORE, addProject, type Store } from '../src/core/model.js'
import { newId, nowIso, readStore, stableStringify, writeStore } from '../src/core/store.js'
import { cleanup, makeTempDataDir } from './helpers.js'

describe('newId', () => {
  it('generates 8-char alphanumeric ids', () => {
    const id = newId()
    assert.equal(id.length, 8)
    assert.match(id, /^[0-9a-zA-Z]{8}$/)
  })

  it('is unique across many calls', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 1000; i++) ids.add(newId())
    assert.equal(ids.size, 1000)
  })
})

describe('nowIso', () => {
  it('returns ISO 8601 ending in Z, second precision', () => {
    const ts = nowIso()
    assert.match(ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
  })
})

describe('stableStringify', () => {
  it('sorts keys deterministically', () => {
    const a = stableStringify({ b: 1, a: 2 })
    const b = stableStringify({ a: 2, b: 1 })
    assert.equal(a, b)
    assert.equal(a, '{\n  "a": 2,\n  "b": 1\n}')
  })

  it('sorts nested object keys', () => {
    const out = stableStringify({ x: { z: 1, y: 2 } })
    assert.equal(out, '{\n  "x": {\n    "y": 2,\n    "z": 1\n  }\n}')
  })

  it('preserves array order', () => {
    const out = stableStringify({ items: [3, 1, 2] })
    assert.match(out, /"items": \[\s*3,\s*1,\s*2\s*\]/)
  })
})

describe('readStore / writeStore', () => {
  it('returns an empty store when file is missing', () => {
    const dir = makeTempDataDir()
    try {
      const s = readStore(dir)
      assert.deepEqual(s, EMPTY_STORE)
    } finally {
      cleanup(dir)
    }
  })

  it('round-trips a store via the file system', () => {
    const dir = makeTempDataDir()
    try {
      const ts = nowIso()
      const seeded = addProject(EMPTY_STORE, {
        id: newId(),
        created_at: ts,
        title: 'Sample',
        note: null,
      }).store
      writeStore(dir, seeded)
      const back = readStore(dir)
      assert.deepEqual(back, seeded)
    } finally {
      cleanup(dir)
    }
  })

  it('writes pretty + sorted JSON ending with a newline', () => {
    const dir = makeTempDataDir()
    try {
      const store: Store = {
        lists: [
          {
            id: 'P1',
            type: 'project',
            title: 'X',
            note: null,
            created_at: '2026-04-27T10:00:00Z',
            status: 'active',
            closed_at: null,
          },
        ],
        items: [],
      }
      writeStore(dir, store)
      const raw = readFileSync(join(dir, 'store.json'), 'utf8')
      assert.ok(raw.endsWith('\n'))
      const firstObj = JSON.parse(raw) as Store
      const projectKeys = Object.keys(firstObj.lists[0])
      assert.deepEqual(projectKeys, [...projectKeys].sort())
    } finally {
      cleanup(dir)
    }
  })

  it('overwrites atomically (no .tmp leftover)', () => {
    const dir = makeTempDataDir()
    try {
      writeStore(dir, EMPTY_STORE)
      writeStore(dir, EMPTY_STORE)
      const entries = readdirSync(dir)
      assert.deepEqual(entries.filter((e) => e.startsWith('store.json.tmp')), [])
      assert.deepEqual(entries.sort(), ['store.json'])
    } finally {
      cleanup(dir)
    }
  })

  it('creates the data dir if missing', () => {
    const parent = makeTempDataDir()
    try {
      const dir = join(parent, 'nested', 'data')
      writeStore(dir, EMPTY_STORE)
      const back = readStore(dir)
      assert.deepEqual(back, EMPTY_STORE)
    } finally {
      cleanup(parent)
    }
  })

  it('reads a hand-written valid store', () => {
    const dir = makeTempDataDir()
    try {
      mkdirSync(dir, { recursive: true })
      const raw = `{"lists":[{"id":"P1","type":"project","title":"Hi","note":null,"created_at":"${nowIso()}","status":"active","closed_at":null}],"items":[]}`
      writeFileSync(join(dir, 'store.json'), raw)
      const back = readStore(dir)
      assert.equal(back.lists.length, 1)
      assert.equal(back.lists[0].id, 'P1')
    } finally {
      cleanup(dir)
    }
  })

  it('normalizes a v0.3 action (no start_at) to start_at: null on read', () => {
    const dir = makeTempDataDir()
    try {
      mkdirSync(dir, { recursive: true })
      const raw = JSON.stringify({
        lists: [],
        items: [
          {
            id: 'A1',
            type: 'action',
            title: 'Old',
            project: null,
            note: null,
            created_at: nowIso(),
            status: 'active',
            due: null,
            closed_at: null,
          },
        ],
      })
      writeFileSync(join(dir, 'store.json'), raw)
      const back = readStore(dir)
      assert.equal(back.items.length, 1)
      const action = back.items[0]
      assert.equal(action.type, 'action')
      assert.equal('start_at' in action, true)
      // @ts-expect-error narrow
      assert.equal(action.start_at, null)
    } finally {
      cleanup(dir)
    }
  })

  it('normalizes an old memo (pinned, no start_at) to start_at: null and drops pinned on write', () => {
    const dir = makeTempDataDir()
    try {
      mkdirSync(dir, { recursive: true })
      const raw = JSON.stringify({
        lists: [],
        items: [
          {
            id: 'M1',
            type: 'memo',
            note: 'Old memo',
            pinned: true,
            project: null,
            created_at: nowIso(),
          },
        ],
      })
      writeFileSync(join(dir, 'store.json'), raw)
      const back = readStore(dir)
      assert.equal(back.items.length, 1)
      const memo = back.items[0]
      assert.equal(memo.type, 'memo')
      assert.equal('start_at' in memo, true)
      assert.equal(memo.start_at, null)
      assert.equal('pinned' in memo, false)

      writeStore(dir, back)
      const written = readFileSync(join(dir, 'store.json'), 'utf8')
      assert.doesNotMatch(written, /"pinned"/)
    } finally {
      cleanup(dir)
    }
  })

  it('normalizes a pre-sub-projects project (no parent) to parent: null on read', () => {
    const dir = makeTempDataDir()
    try {
      mkdirSync(dir, { recursive: true })
      const raw = JSON.stringify({
        lists: [
          {
            id: 'P1',
            type: 'project',
            title: 'P',
            note: null,
            created_at: nowIso(),
            status: 'active',
            closed_at: null,
          },
        ],
        items: [],
      })
      writeFileSync(join(dir, 'store.json'), raw)
      const back = readStore(dir)
      assert.equal(back.lists.length, 1)
      const project = back.lists[0]
      assert.equal(project.type, 'project')
      assert.equal('parent' in project, true)
      assert.equal(project.parent, null)
    } finally {
      cleanup(dir)
    }
  })


  it('throws DoError with a clean message on malformed JSON', () => {
    const dir = makeTempDataDir()
    try {
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'store.json'), '{ this is not json')
      assert.throws(
        () => readStore(dir),
        (err: unknown) => err instanceof DoError && /malformed store\.json/.test((err as Error).message),
      )
    } finally {
      cleanup(dir)
    }
  })
})
