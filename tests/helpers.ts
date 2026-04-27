import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = join(here, '..')
export const CLI_PATH = join(REPO_ROOT, 'dist', 'cli.js')

export function makeTempDir(prefix = 'todo-test-'): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

export function makeTempDataDir(): string {
  return makeTempDir('todo-data-')
}

export function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}

export type CliResult = {
  stdout: string
  stderr: string
  code: number
}

/**
 * Spawn the compiled CLI.
 *
 * `dataDir` (optional) sets `TODO_DATA_DIR`.
 * `home` (optional) sandboxes `$HOME`. When omitted, a fresh sandbox HOME is
 *   created for every call so the CLI never touches the real `~/.todo/`.
 * `env` (optional) adds or overrides env vars (useful for clearing TODO_DATA_DIR).
 */
export function runCli(
  args: string[],
  opts: { dataDir?: string; home?: string; env?: Record<string, string | undefined> } = {},
): CliResult {
  const sandboxHome = opts.home ?? makeTempDir('todo-home-')
  const ownHome = opts.home === undefined
  try {
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      NO_COLOR: '1',
      HOME: sandboxHome,
    }
    if (opts.dataDir) env.TODO_DATA_DIR = opts.dataDir
    if (opts.env) {
      for (const [k, v] of Object.entries(opts.env)) {
        if (v === undefined) delete env[k]
        else env[k] = v
      }
    }
    const res = spawnSync('node', [CLI_PATH, ...args], { env, encoding: 'utf8' })
    return {
      stdout: res.stdout ?? '',
      stderr: res.stderr ?? '',
      code: res.status ?? 0,
    }
  } finally {
    if (ownHome) cleanup(sandboxHome)
  }
}

export function readFile(path: string): string {
  return readFileSync(path, 'utf8')
}

export function readJson<T = unknown>(path: string): T {
  return JSON.parse(readFile(path)) as T
}

export function parseJson<T = unknown>(s: string): T {
  return JSON.parse(s) as T
}
