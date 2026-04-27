import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  ENV_VAR,
  configPath,
  defaultDataDir,
  readConfig,
  resolveDataDir,
  writeConfig,
} from '../src/core/config.js'
import { cleanup, makeTempDir } from './helpers.js'

function withSandboxedHome<T>(fn: (home: string) => T): T {
  const home = makeTempDir('todo-home-')
  const prev = process.env.HOME
  process.env.HOME = home
  try {
    return fn(home)
  } finally {
    if (prev === undefined) delete process.env.HOME
    else process.env.HOME = prev
    cleanup(home)
  }
}

function withoutEnvDataDir<T>(fn: () => T): T {
  const prev = process.env[ENV_VAR]
  delete process.env[ENV_VAR]
  try {
    return fn()
  } finally {
    if (prev === undefined) delete process.env[ENV_VAR]
    else process.env[ENV_VAR] = prev
  }
}

describe('readConfig / writeConfig', () => {
  it('returns { dataDir: null } when config file is missing', () => {
    withSandboxedHome(() => {
      assert.deepEqual(readConfig(), { dataDir: null })
    })
  })

  it('round-trips dataDir', () => {
    withSandboxedHome(() => {
      writeConfig({ dataDir: '/tmp/some/where' })
      assert.deepEqual(readConfig(), { dataDir: '/tmp/some/where' })
    })
  })

  it('writes JSON with sorted keys + trailing newline', () => {
    withSandboxedHome((home) => {
      writeConfig({ dataDir: '/x' })
      const path = join(home, '.todo', 'config.json')
      assert.ok(existsSync(path))
      const raw = readFileSync(path, 'utf8')
      assert.ok(raw.endsWith('\n'))
      assert.equal(raw.trim(), '{\n  "dataDir": "/x"\n}')
    })
  })
})

describe('resolveDataDir', () => {
  it('falls back to default when nothing set', () => {
    withSandboxedHome(() => {
      withoutEnvDataDir(() => {
        const r = resolveDataDir()
        assert.equal(r.source, 'default')
        assert.equal(r.dataDir, defaultDataDir())
      })
    })
  })

  it('reads from config when present', () => {
    withSandboxedHome(() => {
      withoutEnvDataDir(() => {
        writeConfig({ dataDir: '/tmp/from-config' })
        const r = resolveDataDir()
        assert.equal(r.source, 'config')
        assert.equal(r.dataDir, '/tmp/from-config')
      })
    })
  })

  it('env var beats config', () => {
    withSandboxedHome(() => {
      writeConfig({ dataDir: '/tmp/from-config' })
      const prev = process.env[ENV_VAR]
      process.env[ENV_VAR] = '/tmp/from-env'
      try {
        const r = resolveDataDir()
        assert.equal(r.source, 'env')
        assert.equal(r.dataDir, '/tmp/from-env')
      } finally {
        if (prev === undefined) delete process.env[ENV_VAR]
        else process.env[ENV_VAR] = prev
      }
    })
  })

  it('configPath is under HOME/.todo/config.json', () => {
    withSandboxedHome((home) => {
      assert.equal(configPath(), join(home, '.todo', 'config.json'))
    })
  })
})
