import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { readConfig, writeConfig } from '../core/config.js'
import { VaultNotFound } from '../core/errors.js'

export function setVaultCmd(path: string): string {
  const absolute = resolve(path)
  if (!existsSync(absolute)) throw new VaultNotFound(absolute)
  const config = readConfig()
  config.vault = absolute
  writeConfig(config)
  return `vault: ${absolute}`
}
