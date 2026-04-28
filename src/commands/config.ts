import { resolveDataDir, writeConfig } from '../core/config.js'
import { InvalidArgument } from '../core/errors.js'
import { json } from './shared.js'

const KEYS = ['data_dir'] as const
type Key = (typeof KEYS)[number]

function isKey(s: string): s is Key {
  return (KEYS as readonly string[]).includes(s)
}

export function configCmd(key?: string, value?: string): string {
  // Bare `todo config` — list all keys (read).
  if (key === undefined) {
    return `data_dir: ${resolveDataDir().dataDir}`
  }
  if (!isKey(key)) {
    throw new InvalidArgument(
      `unknown config key: ${key} (known: ${KEYS.join(', ')})`,
    )
  }
  // Read: `todo config data_dir`
  if (value === undefined) {
    return `data_dir: ${resolveDataDir().dataDir}`
  }
  // Write: `todo config data_dir <abs-path>`
  writeConfig({ data_dir: value })
  return json({ data_dir: resolveDataDir().dataDir })
}
