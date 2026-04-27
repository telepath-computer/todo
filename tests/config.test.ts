import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { configPath, defaultVaultPath, readConfig, resolveVault, todoHome, writeConfig } from '../src/core/config.js'
import { VaultNotFound } from '../src/core/errors.js'
import { cleanup, makeTempDir, makeTempVault } from './helpers.js'

describe('config.resolveVault', () => {
  let sandboxHome: string
  const origHome = process.env.HOME

  beforeEach(() => {
    sandboxHome = makeTempDir('td-home-')
    process.env.HOME = sandboxHome
  })

  afterEach(() => {
    if (origHome === undefined) delete process.env.HOME
    else process.env.HOME = origHome
    cleanup(sandboxHome)
  })

  it('uses the flag when given and it exists', () => {
    const vault = makeTempVault()
    try {
      assert.equal(resolveVault(vault), vault)
    } finally {
      cleanup(vault)
    }
  })

  it('throws VaultNotFound when flag points at nonexistent path', () => {
    assert.throws(() => resolveVault(join(sandboxHome, 'nope')), VaultNotFound)
  })

  it("uses 'vault' from ~/.todo/config.json when no flag", () => {
    const vault = makeTempVault()
    try {
      mkdirSync(todoHome(), { recursive: true })
      writeFileSync(configPath(), JSON.stringify({ vault }))
      assert.equal(resolveVault(undefined), vault)
    } finally {
      cleanup(vault)
    }
  })

  it('throws VaultNotFound when configured vault is missing', () => {
    mkdirSync(todoHome(), { recursive: true })
    writeFileSync(configPath(), JSON.stringify({ vault: join(sandboxHome, 'nope') }))
    assert.throws(() => resolveVault(undefined), VaultNotFound)
  })

  it('flag overrides config', () => {
    const flagVault = makeTempVault()
    const configVault = makeTempVault()
    try {
      mkdirSync(todoHome(), { recursive: true })
      writeFileSync(configPath(), JSON.stringify({ vault: configVault }))
      assert.equal(resolveVault(flagVault), flagVault)
    } finally {
      cleanup(flagVault)
      cleanup(configVault)
    }
  })

  it('falls back to ~/.todo/default/ when neither flag nor config set', () => {
    const resolved = resolveVault(undefined)
    assert.equal(resolved, defaultVaultPath())
    assert.equal(existsSync(resolved), true, 'default vault is auto-created')
  })

  it('treats malformed config.json as empty and falls back to default', () => {
    mkdirSync(todoHome(), { recursive: true })
    writeFileSync(configPath(), '{ not valid json')
    const resolved = resolveVault(undefined)
    assert.equal(resolved, defaultVaultPath())
  })
})

describe('config.readConfig / writeConfig', () => {
  let sandboxHome: string
  const origHome = process.env.HOME

  beforeEach(() => {
    sandboxHome = makeTempDir('td-home-')
    process.env.HOME = sandboxHome
  })

  afterEach(() => {
    if (origHome === undefined) delete process.env.HOME
    else process.env.HOME = origHome
    cleanup(sandboxHome)
  })

  it('readConfig returns {} when file is missing', () => {
    assert.deepEqual(readConfig(), {})
  })

  it('writeConfig creates ~/.todo/ and persists the config', () => {
    const vault = makeTempVault()
    try {
      writeConfig({ vault })
      assert.equal(existsSync(todoHome()), true)
      const raw = JSON.parse(readFileSync(configPath(), 'utf8'))
      assert.equal(raw.vault, vault)
      assert.deepEqual(readConfig(), { vault })
    } finally {
      cleanup(vault)
    }
  })

  it('readConfig ignores unknown keys', () => {
    mkdirSync(todoHome(), { recursive: true })
    writeFileSync(configPath(), JSON.stringify({ vault: '/tmp', unknown: 'x' }))
    assert.deepEqual(readConfig(), { vault: '/tmp' })
  })
})
