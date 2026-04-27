import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { cleanup, makeTempVault, runCli } from './helpers.js'

describe('e2e: do projects list', () => {
  let vault: string
  beforeEach(() => {
    vault = makeTempVault()
  })
  afterEach(() => cleanup(vault))

  it('outputs nothing when projects dir is missing (piped/non-TTY)', () => {
    const r = runCli(['projects', 'list'], { vault })
    assert.equal(r.code, 0)
    assert.equal(r.stdout, '')
    assert.equal(r.stderr, '')
  })

  it('lists projects with slug and title', () => {
    runCli(['projects', 'add', 'alpha', '--title', 'Alpha'], { vault })
    runCli(['projects', 'add', 'bravo'], { vault })
    const r = runCli(['projects', 'list'], { vault })
    assert.equal(r.code, 0)
    const lines = r.stdout.trim().split('\n')
    assert.equal(lines.length, 2)
    // New format: ✳ <title> [<slug>] per line (piped = single-space, no padding)
    assert.match(lines[0], /^✳ Alpha \[alpha\]$/)
    // bravo has no explicit title — title falls back to slug
    assert.match(lines[1], /^✳ bravo \[bravo\]$/)
  })

  it('falls back to ~/.todo/default/ when no flag and no config', () => {
    // The helper sandboxes $HOME to a temp dir, so this resolves to <sandboxHome>/.todo/default/
    // Use no --vault flag.
    const r = runCli(['projects', 'list'])
    assert.equal(r.code, 0)
    assert.equal(r.stdout, '', 'empty vault produces empty piped output')
  })

  it('errors when --vault points to nonexistent path', () => {
    const r = runCli(['projects', 'list'], { vault: join(vault, 'nope') })
    assert.notEqual(r.code, 0)
    assert.match(r.stderr, /vault not found/)
  })
})

describe('e2e: td set-vault', () => {
  let vault: string
  let home: string
  beforeEach(() => {
    vault = makeTempVault()
    home = makeTempVault()
  })
  afterEach(() => {
    cleanup(vault)
    cleanup(home)
  })

  it('writes ~/.todo/config.json pointing at the given vault', () => {
    const r = runCli(['set-vault', vault], { home })
    assert.equal(r.code, 0)
    assert.equal(r.stdout.trim(), `vault: ${vault}`)
    const configRaw = readFileSync(join(home, '.todo', 'config.json'), 'utf8')
    assert.equal(JSON.parse(configRaw).vault, vault)
  })

  it('resolves relative paths to absolute', () => {
    const r = runCli(['set-vault', '.'], { home })
    assert.equal(r.code, 0)
    // cwd during test is the repo root — should be that absolute path
    const configRaw = readFileSync(join(home, '.todo', 'config.json'), 'utf8')
    const parsed = JSON.parse(configRaw)
    assert.equal(typeof parsed.vault, 'string')
    assert.ok(parsed.vault.startsWith('/'), 'vault path is absolute')
  })

  it('errors when the given path does not exist', () => {
    const r = runCli(['set-vault', join(home, 'nope')], { home })
    assert.notEqual(r.code, 0)
    assert.match(r.stderr, /vault not found/)
  })

  it('lets subsequent commands use the configured vault', () => {
    runCli(['set-vault', vault], { home })
    runCli(['projects', 'add', 'foo'], { home })
    const r = runCli(['projects', 'list'], { home })
    assert.equal(r.code, 0)
    assert.match(r.stdout, /✳ foo \[foo\]/)
  })
})

describe('e2e: do projects add', () => {
  let vault: string
  beforeEach(() => {
    vault = makeTempVault()
  })
  afterEach(() => cleanup(vault))

  it('creates a project file with frontmatter and Available heading', () => {
    const r = runCli(['projects', 'add', 'launch', '--title', 'Launch Project'], { vault })
    assert.equal(r.code, 0)
    assert.match(r.stdout, /Created new project\./)
    assert.match(r.stdout, /id:\s+launch/)
    assert.match(r.stdout, /title:\s+Launch Project/)
    const file = readFileSync(join(vault,'launch.md'), 'utf8')
    assert.match(file, /title: "Launch Project"/)
    assert.match(file, /## Available/)
  })

  it('defaults title to slug when --title omitted', () => {
    runCli(['projects', 'add', 'foo'], { vault })
    const file = readFileSync(join(vault,'foo.md'), 'utf8')
    assert.match(file, /title: "foo"/)
  })

  it('writes project files directly into the vault root', () => {
    runCli(['projects', 'add', 'first'], { vault })
    assert.equal(existsSync(join(vault, 'first.md')), true)
  })

  it('errors on duplicate slug', () => {
    runCli(['projects', 'add', 'dup'], { vault })
    const r = runCli(['projects', 'add', 'dup'], { vault })
    assert.notEqual(r.code, 0)
    assert.match(r.stderr, /already exists/)
  })

  it('errors on invalid slug', () => {
    const r = runCli(['projects', 'add', 'Bad Slug'], { vault })
    assert.notEqual(r.code, 0)
    assert.match(r.stderr, /invalid slug/)
  })
})

describe('e2e: td projects edit', () => {
  let vault: string
  beforeEach(() => {
    vault = makeTempVault()
  })
  afterEach(() => cleanup(vault))

  it('updates the frontmatter title and shows the new title', () => {
    runCli(['projects', 'add', 'podcast', '--title', 'Old'], { vault })
    const r = runCli(['projects', 'edit', 'podcast', '--title', 'The Podcast'], {
      vault,
    })
    assert.equal(r.code, 0)
    assert.match(r.stdout, /Updated project\./)
    assert.match(r.stdout, /id:\s+podcast/)
    assert.match(r.stdout, /title:\s+The Podcast/)
    const file = readFileSync(join(vault,'podcast.md'), 'utf8')
    assert.match(file, /^title: "The Podcast"$/m)
  })

  it('preserves tasks and custom frontmatter when editing title', () => {
    const original = [
      '---',
      'title: "Old"',
      'status: active',
      '---',
      '',
      '## Available',
      '',
      '- [ ] Keep me !2026-05-01',
      '',
    ].join('\n')
    writeFileSync(join(vault, 'rich.md'), original)
    const r = runCli(['projects', 'edit', 'rich', '--title', 'New'], { vault })
    assert.equal(r.code, 0)
    const after = readFileSync(join(vault, 'rich.md'), 'utf8')
    assert.match(after, /^title: "New"$/m)
    assert.match(after, /^status: active$/m)
    assert.match(after, /- \[ \] Keep me !2026-05-01/)
  })

  it('errors when the project does not exist', () => {
    const r = runCli(['projects', 'edit', 'ghost', '--title', 'x'], { vault })
    assert.notEqual(r.code, 0)
    assert.match(r.stderr, /project 'ghost' not found/)
  })

  it('errors when --title is omitted', () => {
    runCli(['projects', 'add', 'foo'], { vault })
    const r = runCli(['projects', 'edit', 'foo'], { vault })
    assert.notEqual(r.code, 0)
    // commander writes its own missing-required-option error
    assert.match(r.stderr, /--title/)
  })
})

describe('e2e: td projects show & notes', () => {
  let vault: string
  beforeEach(() => {
    vault = makeTempVault()
  })
  afterEach(() => cleanup(vault))

  it('round-trips project notes through add and show', () => {
    runCli(
      [
        'projects',
        'add',
        'podcast',
        '--title',
        'The Podcast',
        '--notes',
        'A weekly show.\nHosted by Rupert.',
      ],
      { vault },
    )
    const r = runCli(['projects', 'show', 'podcast'], { vault })
    assert.equal(r.code, 0)
    // Header: ✳ Title  [slug]
    assert.match(r.stdout, /✳ The Podcast\s+\[podcast\]/)
    // Notes appear as plain (italic) prose under the header — no heading.
    assert.match(r.stdout, /A weekly show\.\nHosted by Rupert\./)
    assert.doesNotMatch(r.stdout, /Notes:/)
  })

  it('edit --notes adds, replaces, and clears project notes (in preamble)', () => {
    runCli(['projects', 'add', 'foo'], { vault })
    runCli(['projects', 'edit', 'foo', '--notes', 'First.'], { vault })
    let file = readFileSync(join(vault,'foo.md'), 'utf8')
    // Notes appear as preamble between frontmatter and ## Available
    assert.match(file, /---\n\nFirst\.\n\n## Available/)
    runCli(['projects', 'edit', 'foo', '--notes', 'Second.'], { vault })
    file = readFileSync(join(vault,'foo.md'), 'utf8')
    assert.match(file, /---\n\nSecond\.\n\n## Available/)
    assert.doesNotMatch(file, /First\./)
    runCli(['projects', 'edit', 'foo', '--notes', ''], { vault })
    file = readFileSync(join(vault,'foo.md'), 'utf8')
    assert.doesNotMatch(file, /Second\./)
    assert.doesNotMatch(file, /## Notes/)
  })

  it('show lists Available tasks under the project (no Tasks: heading)', () => {
    runCli(['projects', 'add', 'foo'], { vault })
    runCli(['tasks', 'add', '--title', 'One', '--project', 'foo'], { vault })
    runCli(['tasks', 'add', '--title', 'Two', '--project', 'foo'], { vault })
    const r = runCli(['projects', 'show', 'foo'], { vault })
    assert.equal(r.code, 0)
    assert.doesNotMatch(r.stdout, /Tasks:/)
    assert.match(r.stdout, /\[ \] One/)
    assert.match(r.stdout, /\[ \] Two/)
  })

  it('show renders all incomplete lanes (Available, Waiting, Deferred); Completed excluded', () => {
    runCli(['projects', 'add', 'foo'], { vault })
    runCli(['tasks', 'add', '--title', 'Active', '--project', 'foo'], { vault })
    runCli(['tasks', 'add', '--title', 'Done', '--project', 'foo'], { vault })
    runCli(['tasks', 'add', '--title', 'Blocked', '--project', 'foo', '--waiting'], { vault })
    runCli(['tasks', 'add', '--title', 'Someday', '--project', 'foo', '--deferred'], { vault })
    runCli(['tasks', 'complete', 'foo#2'], { vault })
    const r = runCli(['projects', 'show', 'foo'], { vault })
    assert.match(r.stdout, /Active/)
    assert.match(r.stdout, /Waiting:/)
    assert.match(r.stdout, /Blocked/)
    assert.match(r.stdout, /Deferred:/)
    assert.match(r.stdout, /Someday/)
    assert.doesNotMatch(r.stdout, /Done/)
  })

  it('show context-groups Available items (context-less first, then green @context groups)', () => {
    runCli(['projects', 'add', 'foo'], { vault })
    runCli(['tasks', 'add', '--title', 'Plain', '--project', 'foo'], { vault })
    runCli(
      ['tasks', 'add', '--title', 'BuyMic', '--project', 'foo', '--context', 'errand'],
      { vault },
    )
    const r = runCli(['projects', 'show', 'foo'], { vault })
    const plainIdx = r.stdout.indexOf('Plain')
    const ctxIdx = r.stdout.indexOf('@errand')
    const buyIdx = r.stdout.indexOf('BuyMic')
    assert.ok(plainIdx >= 0 && plainIdx < ctxIdx, `expected Plain before @errand:\n${r.stdout}`)
    assert.ok(ctxIdx < buyIdx, `expected @errand heading before BuyMic:\n${r.stdout}`)
  })
})

describe('e2e: td tasks show & notes', () => {
  let vault: string
  beforeEach(() => {
    vault = makeTempVault()
    runCli(['projects', 'add', 'foo'], { vault })
  })
  afterEach(() => cleanup(vault))

  it('round-trips task notes through add and show', () => {
    runCli(
      [
        'tasks',
        'add',
        '--title',
        'Write release notes',
        '--project',
        'foo',
        '--notes',
        'Include migration section.\nTag Rupert for review.',
      ],
      { vault },
    )
    const r = runCli(['tasks', 'show', 'foo#1'], { vault })
    assert.equal(r.code, 0)
    assert.match(r.stdout, /\[ \] Write release notes/)
    assert.match(r.stdout, /Include migration section\./)
    assert.match(r.stdout, /Tag Rupert for review\./)
    const file = readFileSync(join(vault,'foo.md'), 'utf8')
    assert.match(file, /- \[ \] Write release notes\n\t\*Include migration section\.\n\tTag Rupert for review\.\*/)
  })

  it('tasks list in piped mode renders one task per line regardless of notes', () => {
    runCli(
      ['tasks', 'add', '--title', 'With notes', '--project', 'foo', '--notes', 'hi'],
      { vault },
    )
    runCli(['tasks', 'add', '--title', 'No notes', '--project', 'foo'], { vault })
    const r = runCli(['tasks', 'list', '--project', 'foo'], { vault })
    assert.equal(r.code, 0)
    // Piped output (non-TTY): no preview, no indicator — one line per task.
    const lines = r.stdout.trim().split('\n')
    assert.equal(lines.length, 2)
    assert.ok(lines[0].includes('With notes'))
    assert.ok(lines[1].includes('No notes'))
    assert.doesNotMatch(r.stdout, /…/)
  })

  it('edit --notes adds, replaces, and clears task notes', () => {
    runCli(['tasks', 'add', '--title', 'Task', '--project', 'foo'], { vault })
    runCli(['tasks', 'edit', 'foo#1', '--notes', 'First.'], { vault })
    let file = readFileSync(join(vault,'foo.md'), 'utf8')
    assert.match(file, /- \[ \] Task\n\t\*First\.\*/)
    runCli(['tasks', 'edit', 'foo#1', '--notes', 'Second.'], { vault })
    file = readFileSync(join(vault,'foo.md'), 'utf8')
    assert.match(file, /- \[ \] Task\n\t\*Second\.\*/)
    runCli(['tasks', 'edit', 'foo#1', '--notes', ''], { vault })
    file = readFileSync(join(vault,'foo.md'), 'utf8')
    assert.match(file, /- \[ \] Task\n?$/m)
    assert.doesNotMatch(file, /First|Second/)
  })

  it('escapes lone * and preserves ** (bold) in user-provided notes', () => {
    runCli(['tasks', 'add', '--title', 'Task', '--project', 'foo'], { vault })
    runCli(
      ['tasks', 'edit', 'foo#1', '--notes', 'Call *Bob* about **stuff**'],
      { vault },
    )
    const file = readFileSync(join(vault,'foo.md'), 'utf8')
    // Lone * escaped as \*; ** pairs preserved; whole body wrapped once in *...*
    assert.ok(
      file.includes('\t*Call \\*Bob\\* about **stuff***'),
      `unexpected file contents:\n${file}`,
    )
  })

  it('round-trips notes containing * and ** through parse', () => {
    runCli(['tasks', 'add', '--title', 'Task', '--project', 'foo'], { vault })
    runCli(
      ['tasks', 'edit', 'foo#1', '--notes', 'Call *Bob* about **stuff**'],
      { vault },
    )
    const r = runCli(['tasks', 'show', 'foo#1'], { vault })
    assert.equal(r.code, 0)
    // Notes body in memory has unescaped * and preserved **
    assert.match(r.stdout, /Call \*Bob\* about \*\*stuff\*\*/)
  })

  it('show errors on unknown ref modes', () => {
    const invalid = runCli(['tasks', 'show', 'bad'], { vault })
    assert.notEqual(invalid.code, 0)
    assert.match(invalid.stderr, /invalid ref/)
    const unknownProject = runCli(['tasks', 'show', 'ghost#1'], { vault })
    assert.notEqual(unknownProject.code, 0)
    assert.match(unknownProject.stderr, /project 'ghost' not found/)
    const outOfRange = runCli(['tasks', 'show', 'foo#99'], { vault })
    assert.notEqual(outOfRange.code, 0)
    assert.match(outOfRange.stderr, /out of range/)
  })
})

describe('e2e: do projects remove', () => {
  let vault: string
  beforeEach(() => {
    vault = makeTempVault()
  })
  afterEach(() => cleanup(vault))

  it('removes the project file', () => {
    runCli(['projects', 'add', 'bye', '--title', 'Bye'], { vault })
    const path = join(vault,'bye.md')
    assert.equal(existsSync(path), true)
    const r = runCli(['projects', 'remove', 'bye'], { vault })
    assert.equal(r.code, 0)
    assert.equal(r.stdout.trim(), 'Removed project: bye.')
    assert.equal(existsSync(path), false)
  })

  it('errors when project does not exist', () => {
    const r = runCli(['projects', 'remove', 'ghost'], { vault })
    assert.notEqual(r.code, 0)
    assert.match(r.stderr, /project 'ghost' not found/)
  })
})

describe('e2e: do actions list', () => {
  let vault: string
  beforeEach(() => {
    vault = makeTempVault()
    runCli(['projects', 'add', 'foo'], { vault })
    runCli(['projects', 'add', 'bar'], { vault })
    runCli(['tasks', 'add', '--title', 'One', '--project', 'foo'], { vault })
    runCli(['tasks', 'add', '--title', 'Two', '--project', 'foo'], { vault })
    runCli(['tasks', 'add', '--title', 'Three', '--project', 'bar'], { vault })
  })
  afterEach(() => cleanup(vault))

  it('lists all actions across all projects, sorted by slug', () => {
    const r = runCli(['tasks', 'list'], { vault })
    assert.equal(r.code, 0)
    const lines = r.stdout.trim().split('\n')
    assert.equal(lines.length, 3)
    // listProjectSlugs sorts alphabetically: bar before foo
    assert.ok(lines[0].includes('[bar#1]'))
    assert.ok(lines[0].includes('Three'))
    assert.ok(lines[1].includes('[foo#1]'))
    assert.ok(lines[1].includes('One'))
    assert.ok(lines[2].includes('[foo#2]'))
    assert.ok(lines[2].includes('Two'))
  })

  it('filters by --project', () => {
    const r = runCli(['tasks', 'list', '--project', 'foo'], { vault })
    const lines = r.stdout.trim().split('\n')
    assert.equal(lines.length, 2)
    assert.ok(lines.every((l) => l.includes('foo#')))
  })

  it('errors when --project refers to unknown project', () => {
    const r = runCli(['tasks', 'list', '--project', 'ghost'], { vault })
    assert.notEqual(r.code, 0)
    assert.match(r.stderr, /project 'ghost' not found/)
  })

  it('outputs nothing for empty vault (non-TTY)', () => {
    const emptyVault = makeTempVault()
    try {
      const r = runCli(['tasks', 'list'], { vault: emptyVault })
      assert.equal(r.code, 0)
      assert.equal(r.stdout, '')
    } finally {
      cleanup(emptyVault)
    }
  })
})

describe('e2e: do actions add', () => {
  let vault: string
  beforeEach(() => {
    vault = makeTempVault()
    runCli(['projects', 'add', 'foo'], { vault })
  })
  afterEach(() => cleanup(vault))

  it('appends an action and reports the new ref', () => {
    const r = runCli(['tasks', 'add', '--title', 'Write notes', '--project', 'foo'], { vault })
    assert.equal(r.code, 0)
    assert.ok(r.stdout.includes('[ ]'))
    assert.ok(r.stdout.includes('Write notes'))
    assert.ok(r.stdout.includes('[foo#1]'))
    const file = readFileSync(join(vault,'foo.md'), 'utf8')
    assert.match(file, /- \[ \] Write notes/)
  })

  it('errors when --project is unknown', () => {
    const r = runCli(['tasks', 'add', '--title', 'x', '--project', 'ghost'], { vault })
    assert.notEqual(r.code, 0)
    assert.match(r.stderr, /project 'ghost' not found/)
  })

  it('accepts natural-language --due values', () => {
    const r = runCli(
      ['tasks', 'add', '--title', 'Due soon', '--project', 'foo', '--due', 'today'],
      { vault },
    )
    assert.equal(r.code, 0)
    const now = new Date()
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    assert.ok(
      r.stdout.includes(`!${expected}`),
      `expected due !${expected} in:\n${r.stdout}`,
    )
  })

  it('rejects gibberish --due values', () => {
    const r = runCli(
      ['tasks', 'add', '--title', 'x', '--project', 'foo', '--due', 'asdfasdf'],
      { vault },
    )
    assert.notEqual(r.code, 0)
    assert.match(r.stderr, /invalid date 'asdfasdf'/)
  })
})

describe('e2e: do actions complete / uncomplete', () => {
  let vault: string
  beforeEach(() => {
    vault = makeTempVault()
    runCli(['projects', 'add', 'foo'], { vault })
    runCli(['tasks', 'add', '--title', 'One', '--project', 'foo'], { vault })
  })
  afterEach(() => cleanup(vault))

  it('flips [ ] to [x] in the file', () => {
    const r = runCli(['tasks', 'complete', 'foo#1'], { vault })
    assert.equal(r.code, 0)
    assert.ok(r.stdout.includes('[x]'))
    const file = readFileSync(join(vault,'foo.md'), 'utf8')
    assert.match(file, /- \[x\] One/)
  })

  it('uncomplete flips [x] back to [ ]', () => {
    runCli(['tasks', 'complete', 'foo#1'], { vault })
    const r = runCli(['tasks', 'uncomplete', 'foo#1'], { vault })
    assert.equal(r.code, 0)
    assert.ok(r.stdout.includes('[ ]'))
    const file = readFileSync(join(vault,'foo.md'), 'utf8')
    assert.match(file, /- \[ \] One/)
  })

  it('errors on invalid ref', () => {
    const r = runCli(['tasks', 'complete', 'no-hash'], { vault })
    assert.notEqual(r.code, 0)
    assert.match(r.stderr, /invalid ref/)
  })

  it('errors on unknown project in ref', () => {
    const r = runCli(['tasks', 'complete', 'ghost#1'], { vault })
    assert.notEqual(r.code, 0)
    assert.match(r.stderr, /project 'ghost' not found/)
  })

  it('errors on out-of-range index', () => {
    const r = runCli(['tasks', 'complete', 'foo#99'], { vault })
    assert.notEqual(r.code, 0)
    assert.match(r.stderr, /out of range/)
  })
})

describe('e2e: do actions remove', () => {
  let vault: string
  beforeEach(() => {
    vault = makeTempVault()
    runCli(['projects', 'add', 'foo'], { vault })
    runCli(['tasks', 'add', '--title', 'One', '--project', 'foo'], { vault })
    runCli(['tasks', 'add', '--title', 'Two', '--project', 'foo'], { vault })
    runCli(['tasks', 'add', '--title', 'Three', '--project', 'foo'], { vault })
  })
  afterEach(() => cleanup(vault))

  it('deletes the line and shifts subsequent refs down by one', () => {
    const r = runCli(['tasks', 'remove', 'foo#2'], { vault })
    assert.equal(r.code, 0)
    assert.ok(r.stdout.includes('Two'))
    const listed = runCli(['tasks', 'list', '--project', 'foo'], { vault })
    const lines = listed.stdout.trim().split('\n')
    assert.equal(lines.length, 2)
    assert.ok(lines[0].includes('One'))
    assert.ok(lines[0].includes('[foo#1]'))
    assert.ok(lines[1].includes('Three'))
    assert.ok(lines[1].includes('[foo#2]'))
  })

  it('emits a shift note when removing a non-last task', () => {
    const r = runCli(['tasks', 'remove', 'foo#2'], { vault })
    assert.equal(r.code, 0)
    assert.match(
      r.stdout,
      /Note: refs after #2 in 'foo' have shifted down — re-list before further edits\./,
    )
  })

  it('omits the shift note when removing the last task', () => {
    const r = runCli(['tasks', 'remove', 'foo#3'], { vault })
    assert.equal(r.code, 0)
    assert.doesNotMatch(r.stdout, /Note:/)
  })

  it('errors on invalid ref', () => {
    const r = runCli(['tasks', 'remove', 'bad'], { vault })
    assert.notEqual(r.code, 0)
    assert.match(r.stderr, /invalid ref/)
  })
})

describe('e2e: td tasks edit', () => {
  let vault: string
  beforeEach(() => {
    vault = makeTempVault()
    runCli(['projects', 'add', 'foo'], { vault })
    runCli(['projects', 'add', 'bar'], { vault })
    runCli(['tasks', 'add', '--title', 'One', '--project', 'foo'], { vault })
    runCli(['tasks', 'add', '--title', 'Two', '--project', 'foo'], { vault })
    runCli(['tasks', 'add', '--title', 'Three', '--project', 'foo'], { vault })
  })
  afterEach(() => cleanup(vault))

  it('edits the title in place', () => {
    const r = runCli(['tasks', 'edit', 'foo#2', '--title', 'Updated'], { vault })
    assert.equal(r.code, 0)
    assert.ok(r.stdout.includes('Updated'))
    assert.ok(r.stdout.includes('[foo#2]'))
    assert.doesNotMatch(r.stdout, /Note:/)
    const file = readFileSync(join(vault,'foo.md'), 'utf8')
    assert.match(file, /- \[ \] Updated/)
  })

  it('sets a due date', () => {
    const r = runCli(['tasks', 'edit', 'foo#1', '--due', '2026-09-09'], { vault })
    assert.equal(r.code, 0)
    assert.ok(r.stdout.includes('!2026-09-09'))
    const file = readFileSync(join(vault,'foo.md'), 'utf8')
    assert.match(file, /- \[ \] One !2026-09-09/)
  })

  it("clears a due date with --due ''", () => {
    runCli(['tasks', 'edit', 'foo#1', '--due', '2026-09-09'], { vault })
    const r = runCli(['tasks', 'edit', 'foo#1', '--due', ''], { vault })
    assert.equal(r.code, 0)
    assert.doesNotMatch(r.stdout, /[!@]\d{4}-\d{2}-\d{2}/)
    const file = readFileSync(join(vault,'foo.md'), 'utf8')
    assert.doesNotMatch(file, /[!@]\d{4}-\d{2}-\d{2}/)
  })

  it('moves a task to another project and reports the new ref + move note', () => {
    const r = runCli(['tasks', 'edit', 'foo#2', '--project', 'bar'], { vault })
    assert.equal(r.code, 0)
    assert.ok(r.stdout.includes('Two'))
    assert.ok(r.stdout.includes('[bar#1]'))
    assert.match(r.stdout, /Note: moved from 'foo'/)
    assert.match(
      r.stdout,
      /refs after #2 in 'foo' have shifted down — re-list before further edits/,
    )
    const fooFile = readFileSync(join(vault,'foo.md'), 'utf8')
    const barFile = readFileSync(join(vault,'bar.md'), 'utf8')
    assert.doesNotMatch(fooFile, /- \[ \] Two/)
    assert.match(barFile, /- \[ \] Two/)
  })

  it('combines --project, --title, and --due in one call', () => {
    const r = runCli(
      [
        'tasks',
        'edit',
        'foo#1',
        '--project',
        'bar',
        '--title',
        'Renamed',
        '--due',
        '2027-03-03',
      ],
      { vault },
    )
    assert.equal(r.code, 0)
    assert.ok(r.stdout.includes('Renamed'))
    assert.ok(r.stdout.includes('!2027-03-03'))
    assert.ok(r.stdout.includes('[bar#1]'))
    const barFile = readFileSync(join(vault,'bar.md'), 'utf8')
    assert.match(barFile, /- \[ \] Renamed !2027-03-03/)
  })

  it('omits the shift note when moving the last task in source', () => {
    const r = runCli(['tasks', 'edit', 'foo#3', '--project', 'bar'], { vault })
    assert.equal(r.code, 0)
    assert.match(r.stdout, /Note: moved from 'foo'\./)
    assert.doesNotMatch(r.stdout, /shifted down/)
  })

  it('errors when no flags are given', () => {
    const r = runCli(['tasks', 'edit', 'foo#1'], { vault })
    assert.notEqual(r.code, 0)
    assert.match(r.stderr, /nothing to edit/)
  })

  it('errors on invalid ref', () => {
    const r = runCli(['tasks', 'edit', 'bad', '--title', 'x'], { vault })
    assert.notEqual(r.code, 0)
    assert.match(r.stderr, /invalid ref/)
  })

  it('errors on unknown target project (source left untouched)', () => {
    const r = runCli(['tasks', 'edit', 'foo#1', '--project', 'ghost'], { vault })
    assert.notEqual(r.code, 0)
    assert.match(r.stderr, /project 'ghost' not found/)
    const listed = runCli(['tasks', 'list', '--project', 'foo'], { vault })
    assert.equal(listed.stdout.trim().split('\n').length, 3)
  })

  it('errors on invalid --due value', () => {
    const r = runCli(['tasks', 'edit', 'foo#1', '--due', 'asdfghjkl'], { vault })
    assert.notEqual(r.code, 0)
    assert.match(r.stderr, /invalid date 'asdfghjkl'/)
  })

  it('errors on out-of-range index', () => {
    const r = runCli(['tasks', 'edit', 'foo#99', '--title', 'x'], { vault })
    assert.notEqual(r.code, 0)
    assert.match(r.stderr, /out of range/)
  })

  it('accepts natural-language --due values via chrono', () => {
    const r = runCli(['tasks', 'edit', 'foo#1', '--due', 'tomorrow'], { vault })
    assert.equal(r.code, 0)
    const now = new Date()
    const tmrw = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    const expected = `${tmrw.getFullYear()}-${String(tmrw.getMonth() + 1).padStart(2, '0')}-${String(tmrw.getDate()).padStart(2, '0')}`
    assert.ok(
      r.stdout.includes(`!${expected}`),
      `expected due !${expected} in:\n${r.stdout}`,
    )
    const file = readFileSync(join(vault,'foo.md'), 'utf8')
    assert.ok(file.includes(`!${expected}`))
  })
})

describe('e2e: preservation across mutations', () => {
  let vault: string
  beforeEach(() => {
    vault = makeTempVault()
  })
  afterEach(() => cleanup(vault))

  it('preserves custom frontmatter, headings, and body prose after mutating actions', () => {
    const original = [
      '---',
      'title: "Rich Project"',
      'status: active',
      'tags: [alpha, beta]',
      '---',
      '',
      '# Rich Project',
      '',
      'Some **intro prose** with [[links]].',
      '',
      '## Available',
      '',
      '- [ ] First',
      '- [ ] Second',
      '',
      '## Notes',
      '',
      'Notes prose to preserve.',
      '- bullet',
      '',
      '## References',
      '',
      '- link',
      '',
    ].join('\n')
    writeFileSync(join(vault,'rich.md'), original)

    const r = runCli(['tasks', 'complete', 'rich#1'], { vault })
    assert.equal(r.code, 0)

    const after = readFileSync(join(vault,'rich.md'), 'utf8')
    assert.ok(after.includes('status: active'), 'custom frontmatter preserved')
    assert.ok(after.includes('tags: [alpha, beta]'), 'tags preserved')
    assert.ok(after.includes('Some **intro prose** with [[links]].'), 'body prose preserved')
    assert.ok(after.includes('## Notes'), 'Notes heading preserved')
    assert.ok(after.includes('Notes prose to preserve.'), 'Notes body preserved')
    assert.ok(after.includes('## References'), 'References heading preserved')
    assert.ok(after.includes('- [x] First'), 'action 1 flipped to done')
    assert.ok(after.includes('- [ ] Second'), 'action 2 unchanged')
  })
})

describe('e2e: due-date syntax (! canonical)', () => {
  let vault: string
  beforeEach(() => {
    vault = makeTempVault()
    runCli(['projects', 'add', 'foo'], { vault })
  })
  afterEach(() => cleanup(vault))

  it('writes !YYYY-MM-DD to disk on tasks add --due', () => {
    const r = runCli(
      ['tasks', 'add', '--title', 'Ship it', '--project', 'foo', '--due', '2026-05-01'],
      { vault },
    )
    assert.equal(r.code, 0)
    assert.ok(r.stdout.includes('!2026-05-01'), `expected !-form in output:\n${r.stdout}`)
    const file = readFileSync(join(vault,'foo.md'), 'utf8')
    assert.match(file, /- \[ \] Ship it !2026-05-01/)
    assert.doesNotMatch(file, /@2026-05-01/)
  })

  it('writes !YYYY-MM-DD on tasks edit --due', () => {
    runCli(['tasks', 'add', '--title', 'Thing', '--project', 'foo'], { vault })
    runCli(['tasks', 'edit', 'foo#1', '--due', '2027-09-09'], { vault })
    const file = readFileSync(join(vault,'foo.md'), 'utf8')
    assert.match(file, /- \[ \] Thing !2027-09-09/)
  })

  it('renders !YYYY-MM-DD in tasks list output (not @)', () => {
    runCli(
      ['tasks', 'add', '--title', 'Show me', '--project', 'foo', '--due', '2030-01-01'],
      { vault },
    )
    const r = runCli(['tasks', 'list', '--project', 'foo'], { vault })
    assert.equal(r.code, 0)
    assert.ok(r.stdout.includes('!2030-01-01'), `expected !-form in:\n${r.stdout}`)
    assert.ok(!r.stdout.includes('@2030-01-01'), `should not contain @-form: ${r.stdout}`)
  })

})

describe('e2e: lane flags on tasks add', () => {
  let vault: string
  beforeEach(() => {
    vault = makeTempVault()
    runCli(['projects', 'add', 'foo'], { vault })
  })
  afterEach(() => cleanup(vault))

  it('default lane is Available — task lands under ## Available', () => {
    runCli(['tasks', 'add', '--title', 'A1', '--project', 'foo'], { vault })
    const file = readFileSync(join(vault,'foo.md'), 'utf8')
    assert.match(file, /## Available\n\n- \[ \] A1/)
    assert.doesNotMatch(file, /## Waiting/)
  })

  it('--waiting puts the task under ## Waiting', () => {
    runCli(
      ['tasks', 'add', '--title', 'Reply from Sam', '--project', 'foo', '--waiting'],
      { vault },
    )
    const file = readFileSync(join(vault,'foo.md'), 'utf8')
    assert.match(file, /## Waiting\n\n- \[ \] Reply from Sam/)
  })

  it('--deferred puts the task under ## Deferred', () => {
    runCli(
      ['tasks', 'add', '--title', 'Some day', '--project', 'foo', '--deferred'],
      { vault },
    )
    const file = readFileSync(join(vault,'foo.md'), 'utf8')
    assert.match(file, /## Deferred\n\n- \[ \] Some day/)
  })

  it('mixing tasks across lanes preserves document-order ref numbering', () => {
    runCli(['tasks', 'add', '--title', 'A', '--project', 'foo'], { vault })
    runCli(['tasks', 'add', '--title', 'W', '--project', 'foo', '--waiting'], { vault })
    runCli(['tasks', 'add', '--title', 'D', '--project', 'foo', '--deferred'], { vault })
    runCli(['tasks', 'add', '--title', 'A2', '--project', 'foo'], { vault })

    // After document-order sort: A, A2 (Available) → W (Waiting) → D (Deferred)
    // The multi-lane view renders bold lane headings between blocks, so we just check that
    // each task appears with its expected ref.
    const r = runCli(['tasks', 'list', '--project', 'foo', '--all'], { vault })
    assert.match(r.stdout, /A\s+\[foo#1\]/)
    assert.match(r.stdout, /A2\s+\[foo#2\]/)
    assert.match(r.stdout, /W\s+\[foo#3\]/)
    assert.match(r.stdout, /D\s+\[foo#4\]/)
    // Bold lane headings are present.
    assert.match(r.stdout, /^Waiting:$/m)
    assert.match(r.stdout, /^Deferred:$/m)
  })
})

describe('e2e: lane flags on tasks list', () => {
  let vault: string
  beforeEach(() => {
    vault = makeTempVault()
    runCli(['projects', 'add', 'foo'], { vault })
    runCli(['tasks', 'add', '--title', 'A', '--project', 'foo'], { vault })
    runCli(['tasks', 'add', '--title', 'W', '--project', 'foo', '--waiting'], { vault })
    runCli(['tasks', 'add', '--title', 'D', '--project', 'foo', '--deferred'], { vault })
  })
  afterEach(() => cleanup(vault))

  it('default list shows Available + Waiting (no Deferred), with bold Waiting heading', () => {
    const r = runCli(['tasks', 'list', '--project', 'foo'], { vault })
    assert.equal(r.code, 0)
    assert.match(r.stdout, /A\s+\[foo#1\]/)
    assert.match(r.stdout, /^Waiting:$/m)
    assert.match(r.stdout, /W\s+\[foo#2\]/)
    assert.doesNotMatch(r.stdout, /^Deferred:$/m)
    assert.doesNotMatch(r.stdout, /D\s+\[foo#3\]/)
  })

  it('--all shows all three lanes with bold Waiting/Deferred headings', () => {
    const r = runCli(['tasks', 'list', '--project', 'foo', '--all'], { vault })
    assert.match(r.stdout, /A\s+\[foo#1\]/)
    assert.match(r.stdout, /^Waiting:$/m)
    assert.match(r.stdout, /W\s+\[foo#2\]/)
    assert.match(r.stdout, /^Deferred:$/m)
    assert.match(r.stdout, /D\s+\[foo#3\]/)
  })

  it('--available shows only Available items', () => {
    const r = runCli(['tasks', 'list', '--project', 'foo', '--available'], { vault })
    const lines = r.stdout.trim().split('\n')
    assert.equal(lines.length, 1)
    assert.ok(lines[0].includes('A'))
  })

  it('--waiting shows only Waiting items', () => {
    const r = runCli(['tasks', 'list', '--project', 'foo', '--waiting'], { vault })
    const lines = r.stdout.trim().split('\n')
    assert.equal(lines.length, 1)
    assert.ok(lines[0].includes('W'))
  })

  it('--deferred shows only Deferred items', () => {
    const r = runCli(['tasks', 'list', '--project', 'foo', '--deferred'], { vault })
    const lines = r.stdout.trim().split('\n')
    assert.equal(lines.length, 1)
    assert.ok(lines[0].includes('D'))
  })
})

describe('e2e: lane flags on tasks edit (move between lanes)', () => {
  let vault: string
  beforeEach(() => {
    vault = makeTempVault()
    runCli(['projects', 'add', 'foo'], { vault })
    runCli(['tasks', 'add', '--title', 'One', '--project', 'foo'], { vault })
    runCli(['tasks', 'add', '--title', 'Two', '--project', 'foo'], { vault })
  })
  afterEach(() => cleanup(vault))

  it('moves a task from Available to Waiting and emits the new section', () => {
    const r = runCli(['tasks', 'edit', 'foo#1', '--waiting'], { vault })
    assert.equal(r.code, 0)
    const file = readFileSync(join(vault,'foo.md'), 'utf8')
    assert.match(file, /## Available\n\n- \[ \] Two/)
    assert.match(file, /## Waiting\n\n- \[ \] One/)
  })

  it('moving the only Waiting item back to Available removes the empty Waiting section', () => {
    runCli(['tasks', 'edit', 'foo#1', '--waiting'], { vault })
    let file = readFileSync(join(vault,'foo.md'), 'utf8')
    assert.match(file, /## Waiting/)
    // foo#2 is the waiting one (One) after the move (Two stays available at #1)
    runCli(['tasks', 'edit', 'foo#2', '--available'], { vault })
    file = readFileSync(join(vault,'foo.md'), 'utf8')
    assert.doesNotMatch(file, /## Waiting/)
  })
})

describe('e2e: contexts (--context flag)', () => {
  let vault: string
  beforeEach(() => {
    vault = makeTempVault()
    runCli(['projects', 'add', 'foo'], { vault })
  })
  afterEach(() => cleanup(vault))

  it('tasks add --context attaches a single context tag', () => {
    runCli(
      ['tasks', 'add', '--title', 'Buy mic', '--project', 'foo', '--context', 'errand'],
      { vault },
    )
    const file = readFileSync(join(vault,'foo.md'), 'utf8')
    assert.match(file, /- \[ \] Buy mic @errand/)
  })

  it('tasks add --context can be repeated; emit is alphabetical', () => {
    runCli(
      [
        'tasks',
        'add',
        '--title',
        'Pick up milk',
        '--project',
        'foo',
        '--context',
        'home',
        '--context',
        'errand',
      ],
      { vault },
    )
    const file = readFileSync(join(vault,'foo.md'), 'utf8')
    assert.match(file, /- \[ \] Pick up milk @errand @home/)
  })

  it('tasks add --context agenda:isa preserves the colon literally', () => {
    runCli(
      [
        'tasks',
        'add',
        '--title',
        'Ask Isa',
        '--project',
        'foo',
        '--context',
        'agenda:isa',
      ],
      { vault },
    )
    const file = readFileSync(join(vault,'foo.md'), 'utf8')
    assert.match(file, /- \[ \] Ask Isa @agenda:isa/)
  })

  it('tasks edit --context replaces the entire context list', () => {
    runCli(
      [
        'tasks',
        'add',
        '--title',
        'Errand',
        '--project',
        'foo',
        '--context',
        'errand',
        '--context',
        'home',
      ],
      { vault },
    )
    let file = readFileSync(join(vault,'foo.md'), 'utf8')
    assert.match(file, /@errand @home/)

    runCli(['tasks', 'edit', 'foo#1', '--context', 'phone'], { vault })
    file = readFileSync(join(vault,'foo.md'), 'utf8')
    assert.match(file, /- \[ \] Errand @phone/)
    assert.doesNotMatch(file, /@errand/)
    assert.doesNotMatch(file, /@home/)
  })

  it("tasks edit --context '' clears all contexts", () => {
    runCli(
      ['tasks', 'add', '--title', 'Has ctx', '--project', 'foo', '--context', 'errand'],
      { vault },
    )
    runCli(['tasks', 'edit', 'foo#1', '--context', ''], { vault })
    const file = readFileSync(join(vault,'foo.md'), 'utf8')
    assert.match(file, /- \[ \] Has ctx\n/)
    assert.doesNotMatch(file, /@/)
  })

  it('contexts and due round-trip together', () => {
    runCli(
      [
        'tasks',
        'add',
        '--title',
        'Mixed',
        '--project',
        'foo',
        '--context',
        'errand',
        '--due',
        '2026-05-01',
      ],
      { vault },
    )
    const file = readFileSync(join(vault,'foo.md'), 'utf8')
    // Canonical emit: contexts (alphabetical) before due
    assert.match(file, /- \[ \] Mixed @errand !2026-05-01/)
  })
})

describe('e2e: ## Completed section + complete/uncomplete', () => {
  let vault: string
  beforeEach(() => {
    vault = makeTempVault()
    runCli(['projects', 'add', 'foo'], { vault })
    runCli(['tasks', 'add', '--title', 'One', '--project', 'foo'], { vault })
  })
  afterEach(() => cleanup(vault))

  it('tasks complete moves the item to ## Completed under today', () => {
    const r = runCli(['tasks', 'complete', 'foo#1'], { vault })
    assert.equal(r.code, 0)
    const file = readFileSync(join(vault,'foo.md'), 'utf8')
    assert.match(file, /## Completed\n\n\d{4}-\d{2}-\d{2}:\n\n- \[x\] One/)
    assert.doesNotMatch(file, /## Available\n\n- \[ \] One/)
  })

  it('completed items are excluded from tasks list', () => {
    runCli(['tasks', 'complete', 'foo#1'], { vault })
    const r = runCli(['tasks', 'list', '--project', 'foo'], { vault })
    assert.equal(r.code, 0)
    assert.equal(r.stdout, '')
  })

  it('--all does NOT include completed items either', () => {
    runCli(['tasks', 'complete', 'foo#1'], { vault })
    const r = runCli(['tasks', 'list', '--project', 'foo', '--all'], { vault })
    assert.equal(r.code, 0)
    assert.equal(r.stdout, '')
  })

  it('tasks uncomplete moves the item back to ## Available and clears completedAt', () => {
    runCli(['tasks', 'complete', 'foo#1'], { vault })
    const r = runCli(['tasks', 'uncomplete', 'foo#1'], { vault })
    assert.equal(r.code, 0)
    const file = readFileSync(join(vault,'foo.md'), 'utf8')
    assert.match(file, /## Available\n\n- \[ \] One/)
    assert.doesNotMatch(file, /## Completed/)
  })

  it('completing two tasks the same day groups them under one date label', () => {
    runCli(['tasks', 'add', '--title', 'Two', '--project', 'foo'], { vault })
    runCli(['tasks', 'complete', 'foo#1'], { vault })
    runCli(['tasks', 'complete', 'foo#1'], { vault }) // refs shifted; Two is now #1
    const file = readFileSync(join(vault,'foo.md'), 'utf8')
    const matches = file.match(/^\d{4}-\d{2}-\d{2}:$/gm) ?? []
    assert.equal(matches.length, 1, `expected exactly one date label, got ${matches.length}`)
    assert.match(file, /- \[x\] One/)
    assert.match(file, /- \[x\] Two/)
  })
})

describe('e2e: td list (cross-project dashboard)', () => {
  let vault: string
  beforeEach(() => {
    vault = makeTempVault()
  })
  afterEach(() => cleanup(vault))

  it('renders Tasks + Waiting + Projects sections by default (no Deferred)', () => {
    runCli(['projects', 'add', 'foo'], { vault })
    runCli(['projects', 'add', 'bar'], { vault })
    runCli(['tasks', 'add', '--title', 'A1', '--project', 'foo'], { vault })
    runCli(['tasks', 'add', '--title', 'W1', '--project', 'foo', '--waiting'], { vault })
    runCli(['tasks', 'add', '--title', 'D1', '--project', 'bar', '--deferred'], { vault })
    const r = runCli(['list'], { vault })
    assert.equal(r.code, 0)
    assert.match(r.stdout, /Tasks:/)
    assert.match(r.stdout, /Waiting:/)
    assert.match(r.stdout, /Projects:/)
    assert.doesNotMatch(r.stdout, /Deferred:/)
    assert.match(r.stdout, /A1/)
    assert.match(r.stdout, /W1/)
    // Deferred items not shown without --all
    assert.doesNotMatch(r.stdout, /D1/)
  })

  it('--all adds the Deferred section', () => {
    runCli(['projects', 'add', 'foo'], { vault })
    runCli(['tasks', 'add', '--title', 'D1', '--project', 'foo', '--deferred'], { vault })
    const r = runCli(['list', '--all'], { vault })
    assert.equal(r.code, 0)
    assert.match(r.stdout, /Deferred:/)
    assert.match(r.stdout, /D1/)
  })

  it('excludes completed items', () => {
    runCli(['projects', 'add', 'foo'], { vault })
    runCli(['tasks', 'add', '--title', 'Done', '--project', 'foo'], { vault })
    runCli(['tasks', 'complete', 'foo#1'], { vault })
    const r = runCli(['list', '--all'], { vault })
    assert.doesNotMatch(r.stdout, /\[x\] Done/)
  })

  it('each item shows full ref so it is actionable from the dashboard', () => {
    runCli(['projects', 'add', 'foo'], { vault })
    runCli(['tasks', 'add', '--title', 'A1', '--project', 'foo'], { vault })
    const r = runCli(['list'], { vault })
    assert.match(r.stdout, /\[foo#1\]/)
  })

  it('emits empty piped output when vault is empty (non-TTY)', () => {
    const r = runCli(['list'], { vault })
    assert.equal(r.code, 0)
    assert.equal(r.stdout, '')
  })
})

describe('e2e: rendering polish (context grouping in Available)', () => {
  let vault: string
  beforeEach(() => {
    vault = makeTempVault()
    runCli(['projects', 'add', 'foo'], { vault })
  })
  afterEach(() => cleanup(vault))

  it('multi-lane Available block groups context-less items above @context groups', () => {
    runCli(['tasks', 'add', '--title', 'Plain', '--project', 'foo'], { vault })
    runCli(
      ['tasks', 'add', '--title', 'BuyMic', '--project', 'foo', '--context', 'errand'],
      { vault },
    )
    runCli(['tasks', 'add', '--title', 'BlockedItem', '--project', 'foo', '--waiting'], {
      vault,
    })
    const r = runCli(['tasks', 'list', '--project', 'foo'], { vault })
    // Order: Plain (no context) → @errand heading → BuyMic → Waiting: heading → BlockedItem
    const plainIdx = r.stdout.indexOf('Plain')
    const ctxIdx = r.stdout.indexOf('@errand')
    const buyIdx = r.stdout.indexOf('BuyMic')
    const waitIdx = r.stdout.indexOf('Waiting:')
    const blkIdx = r.stdout.indexOf('BlockedItem')
    assert.ok(
      plainIdx >= 0 && plainIdx < ctxIdx,
      `Plain should appear before @errand:\n${r.stdout}`,
    )
    assert.ok(ctxIdx < buyIdx, `@errand should appear before BuyMic:\n${r.stdout}`)
    assert.ok(buyIdx < waitIdx, `BuyMic should appear before Waiting::\n${r.stdout}`)
    assert.ok(waitIdx < blkIdx, `Waiting: should appear before BlockedItem:\n${r.stdout}`)
  })

  it('single-lane --available view stays flat (no @context headings)', () => {
    runCli(['tasks', 'add', '--title', 'Plain', '--project', 'foo'], { vault })
    runCli(
      ['tasks', 'add', '--title', 'BuyMic', '--project', 'foo', '--context', 'errand'],
      { vault },
    )
    const r = runCli(['tasks', 'list', '--project', 'foo', '--available'], { vault })
    assert.doesNotMatch(r.stdout, /^@errand$/m)
    assert.match(r.stdout, /Plain/)
    assert.match(r.stdout, /BuyMic/)
  })
})

describe('e2e: legacy ## Tasks files no longer parse', () => {
  let vault: string
  beforeEach(() => {
    vault = makeTempVault()
  })
  afterEach(() => cleanup(vault))

  it('errors when a project file uses the old ## Tasks heading', () => {
    const legacy = '---\ntitle: "Old"\n---\n\n## Tasks\n\n- [ ] Hello\n'
    writeFileSync(join(vault,'old.md'), legacy)
    const r = runCli(['tasks', 'list', '--project', 'old'], { vault })
    assert.notEqual(r.code, 0)
    assert.match(r.stderr, /Available/)
  })
})
