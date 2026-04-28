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
import { InvalidArgument } from '../src/core/errors.js'
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
  it('returns { data_dir: null } when config file is missing', () => {
    withSandboxedHome(() => {
      assert.deepEqual(readConfig(), { data_dir: null })
    })
  })

  it('round-trips data_dir', () => {
    withSandboxedHome(() => {
      writeConfig({ data_dir: '/tmp/some/where' })
      assert.deepEqual(readConfig(), { data_dir: '/tmp/some/where' })
    })
  })

  it('writes JSON with sorted keys + trailing newline', () => {
    withSandboxedHome((home) => {
      writeConfig({ data_dir: '/x' })
      const path = join(home, '.todo', 'config.json')
      assert.ok(existsSync(path))
      const raw = readFileSync(path, 'utf8')
      assert.ok(raw.endsWith('\n'))
      assert.equal(raw.trim(), '{\n  "data_dir": "/x"\n}')
    })
  })
})

describe('resolveDataDir', () => {
  it('falls back to default when nothing set', () => {
    withSandboxedHome(() => {
      withoutEnvDataDir(() => {
        const r = resolveDataDir()
        assert.equal(r.dataDir, defaultDataDir())
      })
    })
  })

  it('reads from config when present', () => {
    withSandboxedHome(() => {
      withoutEnvDataDir(() => {
        writeConfig({ data_dir: '/tmp/from-config' })
        const r = resolveDataDir()
        assert.equal(r.dataDir, '/tmp/from-config')
      })
    })
  })

  it('env var beats config', () => {
    withSandboxedHome(() => {
      writeConfig({ data_dir: '/tmp/from-config' })
      const prev = process.env[ENV_VAR]
      process.env[ENV_VAR] = '/tmp/from-env'
      try {
        const r = resolveDataDir()
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

  it('rejects relative paths in writeConfig', () => {
    withSandboxedHome(() => {
      assert.throws(
        () => writeConfig({ data_dir: 'rel/path' }),
        InvalidArgument,
      )
    })
  })

  it('rejects relative paths from env at resolve time', () => {
    withSandboxedHome(() => {
      const prev = process.env[ENV_VAR]
      process.env[ENV_VAR] = 'relative/data'
      try {
        assert.throws(() => resolveDataDir(), InvalidArgument)
      } finally {
        if (prev === undefined) delete process.env[ENV_VAR]
        else process.env[ENV_VAR] = prev
      }
    })
  })
})
