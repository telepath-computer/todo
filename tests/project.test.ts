import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, it } from 'node:test'
import {
  createProject,
  editProject,
  listProjectSlugs,
  parseProject,
  parseTaskLine,
  readProject,
  removeProject,
  serializeProject,
  serializeTaskLine,
  validateSlug,
  writeProject,
} from '../src/core/project.js'
import {
  InvalidSlug,
  MalformedProject,
  NothingToEdit,
  ProjectAlreadyExists,
  ProjectNotFound,
} from '../src/core/errors.js'
import { loadVault } from '../src/core/vault.js'
import { cleanup, makeTempVault, writeProjectFile } from './helpers.js'

describe('project.validateSlug', () => {
  it('accepts lowercase alphanumeric', () => {
    assert.doesNotThrow(() => validateSlug('foo'))
  })

  it('accepts hyphens and dots', () => {
    assert.doesNotThrow(() => validateSlug('launch-telepath-v0.3'))
  })

  it('rejects uppercase', () => {
    assert.throws(() => validateSlug('Foo'), InvalidSlug)
  })

  it('rejects spaces', () => {
    assert.throws(() => validateSlug('foo bar'), InvalidSlug)
  })

  it('rejects underscore', () => {
    assert.throws(() => validateSlug('foo_bar'), InvalidSlug)
  })

  it('rejects leading hyphen', () => {
    assert.throws(() => validateSlug('-foo'), InvalidSlug)
  })

  it('rejects leading dot', () => {
    assert.throws(() => validateSlug('.foo'), InvalidSlug)
  })

  it('rejects hash character', () => {
    assert.throws(() => validateSlug('foo#bar'), InvalidSlug)
  })

  it('rejects empty string', () => {
    assert.throws(() => validateSlug(''), InvalidSlug)
  })
})

describe('due-date syntax (! is the only form)', () => {
  it('parseTaskLine reads !YYYY-MM-DD as due', () => {
    const t = parseTaskLine('- [ ] Write notes !2026-05-01')
    assert.equal(t?.due, '2026-05-01')
    assert.equal(t?.text, 'Write notes')
  })

  it('parseTaskLine does NOT treat trailing @YYYY-MM-DD as due — `@` is for contexts now', () => {
    // Under the v0.2 model, `@<string>` is a context tag (any non-whitespace),
    // so a date-shaped @-token becomes a context literally named `2026-05-01`.
    const t = parseTaskLine('- [ ] Write notes @2026-05-01')
    assert.equal(t?.due, undefined)
    assert.equal(t?.text, 'Write notes')
    assert.deepEqual(t?.contexts, ['2026-05-01'])
  })

  it('parseTaskLine leaves text-internal @ tokens alone', () => {
    const t = parseTaskLine('- [ ] Email user@example.com')
    assert.equal(t?.due, undefined)
    assert.equal(t?.text, 'Email user@example.com')
  })

  it('serializeTaskLine emits !YYYY-MM-DD when due is set', () => {
    const out = serializeTaskLine({ done: false, text: 'Write notes', due: '2026-05-01' })
    assert.equal(out, '- [ ] Write notes !2026-05-01')
  })

  it('round-trips a file with !YYYY-MM-DD unchanged', () => {
    const content = [
      '---',
      'title: "Foo"',
      '---',
      '',
      '## Available',
      '',
      '- [ ] One !2026-05-01',
      '- [x] Two !2027-01-15',
      '',
    ].join('\n')
    const project = parseProject('foo', content)
    assert.equal(project.tasks[0].due, '2026-05-01')
    assert.equal(project.tasks[1].due, '2027-01-15')
    assert.equal(serializeProject(project), content)
  })
})

describe('## Completed section (date-labeled archive)', () => {
  it('parses completed items grouped by YYYY-MM-DD: date labels', () => {
    const content = [
      '---',
      'title: "Foo"',
      '---',
      '',
      '## Available',
      '',
      '## Completed',
      '',
      '2026-05-01:',
      '',
      '- [x] Send invoices',
      '- [x] Post to feed',
      '',
      '2026-04-24:',
      '',
      '- [x] Buy mic',
      '',
    ].join('\n')
    const project = parseProject('foo', content)
    assert.equal(project.tasks.length, 3)
    assert.equal(project.tasks[0].text, 'Send invoices')
    assert.equal(project.tasks[0].lane, 'completed')
    assert.equal(project.tasks[0].completedAt, '2026-05-01')
    assert.equal(project.tasks[0].done, true)
    assert.equal(project.tasks[1].completedAt, '2026-05-01')
    assert.equal(project.tasks[2].text, 'Buy mic')
    assert.equal(project.tasks[2].completedAt, '2026-04-24')
  })

  it('round-trips a file with multiple date labels', () => {
    const content = [
      '---',
      'title: "Foo"',
      '---',
      '',
      '## Available',
      '',
      '- [ ] Active',
      '',
      '## Completed',
      '',
      '2026-05-01:',
      '',
      '- [x] Send invoices',
      '',
      '2026-04-24:',
      '',
      '- [x] Buy mic',
      '',
    ].join('\n')
    const project = parseProject('foo', content)
    assert.equal(serializeProject(project), content)
  })

  it('emits date labels newest-first regardless of input ordering', () => {
    const content = [
      '---',
      'title: "Foo"',
      '---',
      '',
      '## Available',
      '',
      '## Completed',
      '',
      '2026-04-24:',
      '',
      '- [x] Older',
      '',
      '2026-05-01:',
      '',
      '- [x] Newer',
      '',
    ].join('\n')
    const project = parseProject('foo', content)
    const out = serializeProject(project)
    const newerIdx = out.indexOf('Newer')
    const olderIdx = out.indexOf('Older')
    assert.ok(newerIdx > 0 && olderIdx > 0)
    assert.ok(newerIdx < olderIdx, `expected 2026-05-01 (Newer) before 2026-04-24 (Older), got:\n${out}`)
  })

  it('does NOT emit ## Completed when there are no completed items', () => {
    const project = parseProject(
      'foo',
      '---\ntitle: "Foo"\n---\n\n## Available\n\n- [ ] One\n',
    )
    const out = serializeProject(project)
    assert.doesNotMatch(out, /## Completed/)
  })

  it('removes empty date labels: when all items for a date are gone', () => {
    const content = [
      '---',
      'title: "Foo"',
      '---',
      '',
      '## Available',
      '',
      '## Completed',
      '',
      '2026-05-01:',
      '',
      '- [x] Send invoices',
      '',
      '2026-04-24:',
      '',
      '- [x] Buy mic',
      '',
    ].join('\n')
    const project = parseProject('foo', content)
    // Drop the 2026-04-24 task entirely.
    project.tasks = project.tasks.filter((t) => t.completedAt !== '2026-04-24')
    const out = serializeProject(project)
    assert.match(out, /2026-05-01:/)
    assert.doesNotMatch(out, /2026-04-24:/)
  })
})

describe('contexts (@<string> tokens)', () => {
  it('parseTaskLine collects trailing @<string> tokens as contexts', () => {
    const t = parseTaskLine('- [ ] Buy milk @errand @home')
    assert.equal(t?.text, 'Buy milk')
    assert.deepEqual(t?.contexts, ['errand', 'home'])
  })

  it('treats `:` inside a context as a literal character (not a separator)', () => {
    const t = parseTaskLine('- [ ] Ask Isa @agenda:isa')
    assert.deepEqual(t?.contexts, ['agenda:isa'])
  })

  it('round-trips a context named `agenda:` (trailing colon)', () => {
    const t = parseTaskLine('- [ ] Standing item @agenda:')
    assert.deepEqual(t?.contexts, ['agenda:'])
    const out = serializeTaskLine({ done: false, text: 'Standing item', contexts: ['agenda:'] })
    assert.equal(out, '- [ ] Standing item @agenda:')
  })

  it('parses both contexts and a trailing due date in any order', () => {
    const a = parseTaskLine('- [ ] Pick up milk @errand !2026-05-01')
    assert.equal(a?.due, '2026-05-01')
    assert.deepEqual(a?.contexts, ['errand'])
    assert.equal(a?.text, 'Pick up milk')
    // Due date can appear before contexts on input — both are stripped from the right.
    const b = parseTaskLine('- [ ] Pick up milk !2026-05-01 @errand')
    assert.equal(b?.due, '2026-05-01')
    assert.deepEqual(b?.contexts, ['errand'])
  })

  it('serializes contexts alphabetically, with due last', () => {
    const out = serializeTaskLine({
      done: false,
      text: 'Tour the studio',
      contexts: ['home', 'errand'],
      due: '2026-05-01',
    })
    assert.equal(out, '- [ ] Tour the studio @errand @home !2026-05-01')
  })

  it('omits @<context> from emit when contexts list is empty', () => {
    const out = serializeTaskLine({ done: false, text: 'Plain', contexts: [] })
    assert.equal(out, '- [ ] Plain')
  })

  it('round-trips a file containing tasks with contexts and dues', () => {
    const content = [
      '---',
      'title: "Foo"',
      '---',
      '',
      '## Available',
      '',
      '- [ ] Pick up milk @errand @home',
      '- [ ] Reply to Sam @phone !2026-05-01',
      '- [ ] No-context task',
      '',
    ].join('\n')
    const project = parseProject('foo', content)
    assert.equal(serializeProject(project), content)
  })
})

describe('three-lane structure (Available/Waiting/Deferred)', () => {
  it('parses items from all three lane sections, tagged with the right lane', () => {
    const content = [
      '---',
      'title: Foo',
      '---',
      '',
      '## Available',
      '',
      '- [ ] Active',
      '',
      '## Waiting',
      '',
      '- [ ] Blocked on Sam',
      '',
      '## Deferred',
      '',
      '- [ ] Some day',
      '',
    ].join('\n')
    const project = parseProject('foo', content)
    assert.equal(project.tasks.length, 3)
    assert.equal(project.tasks[0].lane, 'available')
    assert.equal(project.tasks[0].text, 'Active')
    assert.equal(project.tasks[1].lane, 'waiting')
    assert.equal(project.tasks[1].text, 'Blocked on Sam')
    assert.equal(project.tasks[2].lane, 'deferred')
    assert.equal(project.tasks[2].text, 'Some day')
  })

  it('round-trips a file with all three lanes unchanged', () => {
    const content = [
      '---',
      'title: "Foo"',
      '---',
      '',
      '## Available',
      '',
      '- [ ] A',
      '',
      '## Waiting',
      '',
      '- [ ] W',
      '',
      '## Deferred',
      '',
      '- [ ] D',
      '',
    ].join('\n')
    const project = parseProject('foo', content)
    assert.equal(serializeProject(project), content)
  })

  it('always emits ## Available even when the project has no tasks', () => {
    const project = parseProject(
      'foo',
      '---\ntitle: "Foo"\n---\n\n## Available\n',
    )
    project.tasks = []
    const out = serializeProject(project)
    assert.match(out, /^## Available$/m)
    assert.doesNotMatch(out, /## Waiting/)
    assert.doesNotMatch(out, /## Deferred/)
  })

  it('omits ## Waiting and ## Deferred when those lanes are empty', () => {
    const project = parseProject(
      'foo',
      '---\ntitle: "Foo"\n---\n\n## Available\n\n- [ ] One\n',
    )
    const out = serializeProject(project)
    assert.match(out, /## Available/)
    assert.doesNotMatch(out, /## Waiting/)
    assert.doesNotMatch(out, /## Deferred/)
  })

  it('emits ## Waiting when at least one waiting item exists', () => {
    const project = parseProject(
      'foo',
      '---\ntitle: "Foo"\n---\n\n## Available\n',
    )
    project.tasks.push({ done: false, text: 'wait', lane: 'waiting', contexts: [] })
    const out = serializeProject(project)
    assert.match(out, /## Waiting\n\n- \[ \] wait/)
  })

  it('refs across lanes are flat and document-ordered (Available → Waiting → Deferred)', () => {
    const content = [
      '---',
      'title: "Foo"',
      '---',
      '',
      '## Available',
      '',
      '- [ ] A1',
      '- [ ] A2',
      '',
      '## Waiting',
      '',
      '- [ ] W1',
      '',
      '## Deferred',
      '',
      '- [ ] D1',
      '',
    ].join('\n')
    const project = parseProject('foo', content)
    // Indexes are 1-based positions in project.tasks, which is in document order.
    assert.equal(project.tasks[0].text, 'A1')
    assert.equal(project.tasks[1].text, 'A2')
    assert.equal(project.tasks[2].text, 'W1')
    assert.equal(project.tasks[3].text, 'D1')
  })

  it('throws MalformedProject when ## Available is missing entirely', () => {
    const content = '---\ntitle: "X"\n---\n\n# X\n'
    assert.throws(() => parseProject('x', content), MalformedProject)
  })

  it('does NOT recognize legacy ## Tasks heading — file fails to parse', () => {
    const content = '---\ntitle: "X"\n---\n\n## Tasks\n\n- [ ] One\n'
    assert.throws(() => parseProject('x', content), MalformedProject)
  })
})

describe('project.parseProject & serializeProject', () => {
  it('round-trips a minimal freshly-created project', () => {
    const content = '---\ntitle: "Launch"\n---\n\n## Available\n'
    const project = parseProject('launch', content)
    assert.equal(project.title, 'Launch')
    assert.deepEqual(project.tasks, [])
    assert.equal(serializeProject(project), content)
  })

  it('parses actions from a populated Actions section', () => {
    const content =
      '---\ntitle: "Launch"\n---\n\n## Available\n\n- [ ] One\n- [x] Two\n- [ ] Three\n'
    const project = parseProject('launch', content)
    assert.deepEqual(project.tasks, [
      { done: false, text: 'One', lane: 'available', contexts: [] },
      { done: true, text: 'Two', lane: 'available', contexts: [] },
      { done: false, text: 'Three', lane: 'available', contexts: [] },
    ])
  })

  it('preserves rich frontmatter, preamble notes, and tail sections through round-trip', () => {
    const content = [
      '---',
      'title: "Launch Telepath v0.3"',
      'status: active',
      'tags: [launch, telepath]',
      'created: 2026-04-10',
      '---',
      '',
      'Some intro prose here with **bold** and [[wikilinks]].',
      '',
      '## Available',
      '',
      '- [ ] Write the release notes',
      '- [x] Draft the changelog',
      '',
      '## References',
      '',
      'See [[other-project]].',
      '',
    ].join('\n')
    const project = parseProject('launch', content)
    assert.equal(project.title, 'Launch Telepath v0.3')
    assert.equal(project.tasks.length, 2)
    assert.equal(project.notes, 'Some intro prose here with **bold** and [[wikilinks]].')
    assert.equal(serializeProject(project), content)
  })

  it('preserves non-Actions content when actions are mutated', () => {
    const original = [
      '---',
      'title: "Launch"',
      'status: active',
      '---',
      '',
      '# Launch',
      '',
      'Important context prose.',
      '',
      '## Available',
      '',
      '- [ ] One',
      '',
      '## Notes',
      '',
      'Keep this prose intact.',
      '',
    ].join('\n')
    const project = parseProject('launch', original)
    project.tasks.push({ done: false, text: 'Two', lane: 'available', contexts: [] })
    const updated = serializeProject(project)
    assert.ok(updated.includes('status: active'), 'custom frontmatter preserved')
    assert.ok(updated.includes('Important context prose.'), 'body prose preserved')
    assert.ok(updated.includes('Keep this prose intact.'), 'Notes section preserved')
    assert.ok(updated.includes('- [ ] Two'), 'new action added')
  })

  it('throws MalformedProject when Actions section is missing', () => {
    const content = '---\ntitle: "X"\n---\n\n# X\n'
    assert.throws(() => parseProject('x', content), MalformedProject)
  })

  it('parses title without quotes', () => {
    const content = '---\ntitle: Plain Title\n---\n\n## Available\n'
    const project = parseProject('x', content)
    assert.equal(project.title, 'Plain Title')
  })

  it('falls back to slug when no title frontmatter', () => {
    const content = '---\nstatus: active\n---\n\n## Available\n'
    const project = parseProject('my-slug', content)
    assert.equal(project.title, 'my-slug')
  })

  it('treats Actions section content without checkbox prefix as non-actions (parses only checkbox lines)', () => {
    const content = '---\ntitle: "X"\n---\n\n## Available\n\n- [ ] One\nnot a checkbox\n- [ ] Two\n'
    const project = parseProject('x', content)
    assert.deepEqual(project.tasks.map((a) => a.text), ['One', 'Two'])
  })
})

describe('project lifecycle (createProject / readProject / writeProject / removeProject)', () => {
  let vaultDir: string
  beforeEach(() => {
    vaultDir = makeTempVault()
  })
  afterEach(() => {
    cleanup(vaultDir)
  })

  it('creates a project file and returns the Project', () => {
    const vault = loadVault(vaultDir)
    const project = createProject(vault, 'launch', 'Launch Telepath')
    assert.equal(project.slug, 'launch')
    assert.equal(project.title, 'Launch Telepath')
    assert.deepEqual(project.tasks, [])
    const raw = readFileSync(`${vaultDir}/launch.md`, 'utf8')
    assert.ok(raw.includes('title: "Launch Telepath"'))
    assert.ok(raw.includes('## Available'))
  })

  it('createProject defaults title to slug when --title omitted', () => {
    const vault = loadVault(vaultDir)
    const project = createProject(vault, 'foo-bar')
    assert.equal(project.title, 'foo-bar')
  })

  it('createProject throws when slug already exists', () => {
    const vault = loadVault(vaultDir)
    createProject(vault, 'dup')
    assert.throws(() => createProject(vault, 'dup'), ProjectAlreadyExists)
  })

  it('createProject throws InvalidSlug on bad slug', () => {
    const vault = loadVault(vaultDir)
    assert.throws(() => createProject(vault, 'Bad Slug'), InvalidSlug)
  })

  it('readProject throws ProjectNotFound for missing file', () => {
    const vault = loadVault(vaultDir)
    assert.throws(() => readProject(vault, 'missing'), ProjectNotFound)
  })

  it('readProject round-trips a handwritten rich file', () => {
    const content = [
      '---',
      'title: "My Project"',
      'status: active',
      '---',
      '',
      'Context prose.',
      '',
      '## Available',
      '',
      '- [ ] One',
      '- [x] Two',
      '',
      '## References',
      '',
      'Other refs.',
      '',
    ].join('\n')
    writeProjectFile(vaultDir, 'my-project', content)
    const vault = loadVault(vaultDir)
    const project = readProject(vault, 'my-project')
    assert.equal(project.title, 'My Project')
    assert.equal(project.tasks.length, 2)
    assert.equal(project.notes, 'Context prose.')
    writeProject(vault, project)
    const after = readFileSync(`${vaultDir}/my-project.md`, 'utf8')
    assert.equal(after, content)
  })

  it('removeProject deletes the file and returns the project', () => {
    const vault = loadVault(vaultDir)
    createProject(vault, 'bye')
    const removed = removeProject(vault, 'bye')
    assert.equal(removed.slug, 'bye')
    assert.throws(() => readProject(vault, 'bye'), ProjectNotFound)
  })

  it('removeProject throws ProjectNotFound for missing file', () => {
    const vault = loadVault(vaultDir)
    assert.throws(() => removeProject(vault, 'missing'), ProjectNotFound)
  })

  it('listProjectSlugs returns empty array when projects dir is missing', () => {
    const vault = loadVault(vaultDir)
    assert.deepEqual(listProjectSlugs(vault), [])
  })

  it('listProjectSlugs returns sorted slugs, filtering non-.md files and invalid slugs', () => {
    const vault = loadVault(vaultDir)
    createProject(vault, 'zebra')
    createProject(vault, 'alpha')
    createProject(vault, 'mike')
    writeProjectFile(vaultDir, 'not-markdown', 'noise') // .md extension still — qualifies
    assert.deepEqual(listProjectSlugs(vault), ['alpha', 'mike', 'not-markdown', 'zebra'])
  })

  it('editProject updates the frontmatter title in place', () => {
    const vault = loadVault(vaultDir)
    createProject(vault, 'foo', 'Original Title')
    const updated = editProject(vault, 'foo', { title: 'New Title' })
    assert.equal(updated.title, 'New Title')
    assert.equal(readProject(vault, 'foo').title, 'New Title')
  })

  it('editProject preserves custom frontmatter keys, tasks, and body prose', () => {
    const original = [
      '---',
      'title: "Original"',
      'status: active',
      'tags: [alpha, beta]',
      '---',
      '',
      '# Heading',
      '',
      'Some **prose** with [[links]].',
      '',
      '## Available',
      '',
      '- [ ] Keep this task',
      '- [x] And this one',
      '',
      '## Notes',
      '',
      'Freeform notes stay put.',
      '',
    ].join('\n')
    writeProjectFile(vaultDir, 'rich', original)
    const vault = loadVault(vaultDir)
    editProject(vault, 'rich', { title: 'Renamed' })
    const after = readFileSync(`${vaultDir}/rich.md`, 'utf8')
    assert.match(after, /^title: "Renamed"$/m)
    assert.match(after, /^status: active$/m)
    assert.match(after, /^tags: \[alpha, beta\]$/m)
    assert.match(after, /# Heading/)
    assert.match(after, /Some \*\*prose\*\* with \[\[links\]\]/)
    assert.match(after, /- \[ \] Keep this task/)
    assert.match(after, /- \[x\] And this one/)
    assert.match(after, /## Notes/)
    assert.match(after, /Freeform notes stay put\./)
  })

  it('editProject injects a title key when the frontmatter is missing one', () => {
    const original = ['---', 'status: active', '---', '', '## Available', ''].join('\n')
    writeProjectFile(vaultDir, 'no-title', original)
    const vault = loadVault(vaultDir)
    const updated = editProject(vault, 'no-title', { title: 'Added' })
    assert.equal(updated.title, 'Added')
    const after = readFileSync(`${vaultDir}/no-title.md`, 'utf8')
    assert.match(after, /^title: "Added"$/m)
    assert.match(after, /^status: active$/m)
  })

  it('editProject throws NothingToEdit when no fields are given', () => {
    const vault = loadVault(vaultDir)
    createProject(vault, 'foo')
    assert.throws(() => editProject(vault, 'foo', {}), NothingToEdit)
  })

  it('editProject throws ProjectNotFound for missing slug', () => {
    const vault = loadVault(vaultDir)
    assert.throws(
      () => editProject(vault, 'ghost', { title: 'x' }),
      ProjectNotFound,
    )
  })

  it('editProject throws InvalidSlug for malformed slug', () => {
    const vault = loadVault(vaultDir)
    assert.throws(
      () => editProject(vault, 'Bad Slug', { title: 'x' }),
      InvalidSlug,
    )
  })

  it('parses task notes from tab-indented italic continuation (Obsidian format)', () => {
    const content = [
      '---',
      'title: Foo',
      '---',
      '',
      '## Available',
      '',
      '- [ ] Record a theme song !2026-04-24',
      '\t*Hello world!*',
      '- [ ] Create marketing assets',
      '',
    ].join('\n')
    const parsed = parseProject('foo', content)
    assert.equal(parsed.tasks.length, 2)
    assert.equal(parsed.tasks[0].notes, 'Hello world!')
    assert.equal(parsed.tasks[1].notes, undefined)
  })

  it('parses legacy 2-space indented notes', () => {
    const content = [
      '---',
      'title: Foo',
      '---',
      '',
      '## Available',
      '',
      '- [ ] First task',
      '  First note line.',
      '  Second note line.',
      '',
    ].join('\n')
    const parsed = parseProject('foo', content)
    assert.equal(parsed.tasks[0].notes, 'First note line.\nSecond note line.')
  })

  it('round-trips a task with multi-line notes as tab-indented italic', () => {
    const vault = loadVault(vaultDir)
    createProject(vault, 'foo')
    const project = readProject(vault, 'foo')
    project.tasks.push({
      done: false,
      text: 'Write it',
      lane: 'available',
      contexts: [],
      notes: 'Line one.\nLine two.',
    })
    writeProject(vault, project)
    const raw = readFileSync(`${vaultDir}/foo.md`, 'utf8')
    assert.match(raw, /- \[ \] Write it\n\t\*Line one\.\n\tLine two\.\*/)
    const reparsed = readProject(vault, 'foo')
    assert.equal(reparsed.tasks[0].notes, 'Line one.\nLine two.')
  })

  it('parses project notes from the preamble (between frontmatter and ## Available)', () => {
    const content = [
      '---',
      'title: Foo',
      '---',
      '',
      'Some prose.',
      'With two lines.',
      '',
      '## Available',
      '',
      '- [ ] One',
      '',
    ].join('\n')
    const parsed = parseProject('foo', content)
    assert.equal(parsed.notes, 'Some prose.\nWith two lines.')
  })

  it('createProject with notes emits the prose as preamble (above ## Available)', () => {
    const vault = loadVault(vaultDir)
    createProject(vault, 'foo', 'Foo Title', 'The project notes.')
    const raw = readFileSync(`${vaultDir}/foo.md`, 'utf8')
    // Preamble: prose appears between frontmatter and the lane heading
    assert.match(raw, /---\n\nThe project notes\.\n\n## Available/)
    assert.doesNotMatch(raw, /## Notes/)
    assert.equal(readProject(vault, 'foo').notes, 'The project notes.')
  })

  it('editProject can add, replace, and clear preamble notes', () => {
    const vault = loadVault(vaultDir)
    createProject(vault, 'foo')
    editProject(vault, 'foo', { notes: 'First pass.' })
    assert.equal(readProject(vault, 'foo').notes, 'First pass.')
    editProject(vault, 'foo', { notes: 'Second pass.' })
    assert.equal(readProject(vault, 'foo').notes, 'Second pass.')
    editProject(vault, 'foo', { notes: '' })
    assert.equal(readProject(vault, 'foo').notes, undefined)
    const raw = readFileSync(`${vaultDir}/foo.md`, 'utf8')
    assert.doesNotMatch(raw, /## Notes/)
    assert.doesNotMatch(raw, /pass/)
  })

  it('preserves user-added tail sections (e.g. ## Resources) verbatim when editing notes', () => {
    const original = [
      '---',
      'title: Foo',
      '---',
      '',
      '## Available',
      '',
      '- [ ] One',
      '',
      '## Resources',
      '',
      'Resource line.',
      '',
    ].join('\n')
    writeProjectFile(vaultDir, 'rich', original)
    const vault = loadVault(vaultDir)
    editProject(vault, 'rich', { notes: 'Added notes.' })
    const raw = readFileSync(`${vaultDir}/rich.md`, 'utf8')
    // Notes go in preamble (above ## Available), not as a ## Notes section.
    assert.match(raw, /---\n\nAdded notes\.\n\n## Available/)
    // ## Resources is preserved as tail.
    assert.match(raw, /## Resources\n\nResource line\./)
    assert.doesNotMatch(raw, /## Notes/)
  })

  it('escapes leading # in preamble on write so user prose cannot accidentally open a section', () => {
    const vault = loadVault(vaultDir)
    createProject(vault, 'foo')
    editProject(vault, 'foo', { notes: '## Available\nnext line' })
    const raw = readFileSync(`${vaultDir}/foo.md`, 'utf8')
    assert.match(raw, /\\## Available/)
    // Read back round-trips to the original (unescaped) string.
    assert.equal(readProject(vault, 'foo').notes, '## Available\nnext line')
  })
})
