import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { InvalidArgument } from './errors.js'
import { stableStringify } from './store.js'

export type Config = {
  dataDir: string | null
}

export type ResolvedConfig = {
  dataDir: string
  source: 'env' | 'config' | 'default'
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
  if (!existsSync(path)) return { dataDir: null }
  const raw = readFileSync(path, 'utf8')
  const parsed = JSON.parse(raw) as Partial<Config>
  return { dataDir: typeof parsed.dataDir === 'string' ? parsed.dataDir : null }
}

function requireAbsolute(path: string, source: string): void {
  if (!isAbsolute(path)) {
    throw new InvalidArgument(
      `data dir must be an absolute path (${source}: ${JSON.stringify(path)})`,
    )
  }
}

export function writeConfig(c: Config): void {
  if (c.dataDir !== null) requireAbsolute(c.dataDir, 'config')
  const path = configPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, stableStringify(c) + '\n')
}

export function resolveDataDir(): ResolvedConfig {
  const fromEnv = process.env[ENV_VAR]
  if (fromEnv && fromEnv.length > 0) {
    requireAbsolute(fromEnv, 'env TODO_DATA_DIR')
    return { dataDir: fromEnv, source: 'env' }
  }
  const cfg = readConfig()
  if (cfg.dataDir) {
    requireAbsolute(cfg.dataDir, 'config')
    return { dataDir: cfg.dataDir, source: 'config' }
  }
  return { dataDir: defaultDataDir(), source: 'default' }
}
