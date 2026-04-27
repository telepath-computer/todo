import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = join(here, '..')
export const CLI_PATH = join(REPO_ROOT, 'dist', 'cli.js')

export function makeTempDir(prefix = 'td-test-'): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

export function makeTempVault(): string {
  return makeTempDir('td-vault-')
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
 * `vault` (optional) passes `--vault <path>`.
 * `home` (optional) sandboxes $HOME so the CLI doesn't touch the real `~/.td/`.
 *   When omitted, the helper auto-creates a fresh sandbox HOME for every call.
 * `env` (optional) adds or overrides env vars.
 */
export function runCli(
  args: string[],
  opts: { vault?: string; home?: string; env?: Record<string, string> } = {},
): CliResult {
  const sandboxHome = opts.home ?? makeTempDir('td-home-')
  const ownHome = opts.home === undefined
  try {
    const baseArgs: string[] = []
    if (opts.vault) baseArgs.push('--vault', opts.vault)
    const res = spawnSync('node', [CLI_PATH, ...baseArgs, ...args], {
      env: {
        ...process.env,
        NO_COLOR: '1',
        HOME: sandboxHome,
        ...(opts.env ?? {}),
      },
      encoding: 'utf8',
    })
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

export function writeProjectFile(vault: string, slug: string, content: string): string {
  mkdirSync(vault, { recursive: true })
  const path = join(vault, `${slug}.md`)
  writeFileSync(path, content)
  return path
}
