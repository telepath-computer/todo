import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { InvalidArgument } from './errors.js'
import { stableStringify } from './store.js'

export type Config = {
  data_dir: string | null
}

export const ENV_VAR = 'TODO_DATA_DIR'

export function configPath(): string {
  return join(homedir(), '.todo', 'config.json')
}

export function defaultDataDir(): string {
  return join(homedir(), '.todo', 'data')
}

export function readConfig(): Config {
  const path = configPath()
  if (!existsSync(path)) return { data_dir: null }
  const raw = readFileSync(path, 'utf8')
  const parsed = JSON.parse(raw) as Partial<Config>
  return { data_dir: typeof parsed.data_dir === 'string' ? parsed.data_dir : null }
}

function requireAbsolute(path: string, source: string): void {
  if (!isAbsolute(path)) {
    throw new InvalidArgument(
      `data dir must be an absolute path (${source}: ${JSON.stringify(path)})`,
    )
  }
}

export function writeConfig(c: Config): void {
  if (c.data_dir !== null) requireAbsolute(c.data_dir, 'config')
  const path = configPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, stableStringify(c) + '\n')
}

export function resolveDataDir(): { dataDir: string } {
  const fromEnv = process.env[ENV_VAR]
  if (fromEnv && fromEnv.length > 0) {
    requireAbsolute(fromEnv, 'env TODO_DATA_DIR')
    return { dataDir: fromEnv }
  }
  const cfg = readConfig()
  if (cfg.data_dir) {
    requireAbsolute(cfg.data_dir, 'config')
    return { dataDir: cfg.data_dir }
  }
  return { dataDir: defaultDataDir() }
}
