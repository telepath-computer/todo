import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { customAlphabet } from 'nanoid'
import { DoError } from './errors.js'
import type { Store } from './model.js'
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
  try {
    return JSON.parse(raw) as Store
  } catch (err) {
    throw new DoError(`malformed store.json at ${path}: ${(err as Error).message}`)
  }
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
