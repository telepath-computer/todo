import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { VaultNotFound } from './errors.js'

export type AppConfig = {
  vault?: string
}

export function todoHome(): string {
  return join(homedir(), '.todo')
}

export function configPath(): string {
  return join(todoHome(), 'config.json')
}

export function defaultVaultPath(): string {
  return join(todoHome(), 'default')
}

export function readConfig(): AppConfig {
  const path = configPath()
  if (!existsSync(path)) return {}
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    const config: AppConfig = {}
    if (typeof raw.vault === 'string') config.vault = raw.vault
    return config
  } catch {
    return {}
  }
}

export function writeConfig(config: AppConfig): void {
  mkdirSync(todoHome(), { recursive: true })
  writeFileSync(configPath(), JSON.stringify(config, null, 2) + '\n')
}

/**
 * Resolve the vault directory.
 *
 * Precedence:
 *   1. `vaultFlag` (from `--vault <path>`). Must exist.
 *   2. `vault` key in `~/.todo/config.json`. Must exist.
 *   3. Default: `~/.todo/default/`. Auto-created if missing.
 */
export function resolveVault(vaultFlag: string | undefined): string {
  if (vaultFlag) {
    if (!existsSync(vaultFlag)) throw new VaultNotFound(vaultFlag)
    return vaultFlag
  }
  const config = readConfig()
  if (config.vault) {
    if (!existsSync(config.vault)) throw new VaultNotFound(config.vault)
    return config.vault
  }
  const def = defaultVaultPath()
  mkdirSync(def, { recursive: true })
  return def
}
