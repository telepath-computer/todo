import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { customAlphabet } from 'nanoid'
import { DoError } from './errors.js'
import type { ActionItem, Item, MemoItem, ProjectList, Store } from './model.js'
import { EMPTY_STORE } from './model.js'

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
const idGen = customAlphabet(ALPHABET, 8)

export function newId(): string {
  return idGen()
}

export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export function storePath(dataDir: string): string {
  return join(dataDir, 'store.json')
}

export function readStore(dataDir: string): Store {
  const path = storePath(dataDir)
  if (!existsSync(path)) return EMPTY_STORE
  const raw = readFileSync(path, 'utf8')
  let parsed: Store & { meta?: { context?: string | null } }
  try {
    parsed = JSON.parse(raw) as Store & { meta?: { context?: string | null } }
  } catch (err) {
    throw new DoError(`malformed store.json at ${path}: ${(err as Error).message}`)
  }
  return normalizeStore(parsed)
}

// Forward-compat normalisation: stores written by older versions may be
// missing fields introduced later. Fill defaults so the rest of the code
// can treat the schema as strict.
function normalizeStore(s: Store & { meta?: { context?: string | null } }): Store {
  const items = s.items.map((i): Item => {
    if (i.type === 'action') {
      const raw = i as ActionItem & { start_at?: string | null }
      if (raw.start_at === undefined) return { ...raw, start_at: null }
    }
    if (i.type === 'memo') {
      const raw = i as MemoItem & { pinned?: boolean; project?: string | null }
      if (raw.pinned === undefined || raw.project === undefined) {
        return {
          ...raw,
          pinned: raw.pinned ?? false,
          project: raw.project ?? null,
        }
      }
    }
    return i
  })
  const lists = s.lists.map((l) => {
    if (l.type === 'project') {
      const raw = l as ProjectList & { parent?: string | null }
      if (raw.parent === undefined) return { ...raw, parent: null }
    }
    return l
  })
  const context = typeof s.meta?.context === 'string' ? s.meta.context : null
  if (context !== null && context.trim().length > 0) {
    items.push({
      id: newId(),
      type: 'memo',
      note: context,
      pinned: true,
      project: null,
      created_at: nowIso(),
    })
  }
  return { lists, items }
}

export function writeStore(dataDir: string, store: Store): void {
  mkdirSync(dataDir, { recursive: true })
  const path = storePath(dataDir)
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  const body = stableStringify(store) + '\n'
  const fd = openSync(tmp, 'w', 0o644)
  try {
    writeSync(fd, body)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(tmp, path)
}

// Sorted-key pretty stringify (2-space indent) for diffable JSON.
export function stableStringify(value: unknown, indent = 2): string {
  return JSON.stringify(value, sortedReplacer, indent)
}

function sortedReplacer(this: unknown, _key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {}
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k]
    }
    return sorted
  }
  return value
}
