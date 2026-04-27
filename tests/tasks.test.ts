import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, it } from 'node:test'
import {
  addTask,
  completeTask,
  editTask,
  listTasks,
  removeTask,
  uncompleteTask,
} from '../src/core/tasks.js'
import { createProject, readProject } from '../src/core/project.js'
import {
  IndexOutOfRange,
  InvalidDate,
  InvalidRef,
  NothingToEdit,
  ProjectNotFound,
} from '../src/core/errors.js'
import { loadVault } from '../src/core/vault.js'
import { cleanup, makeTempVault } from './helpers.js'

describe('actions.listTasks', () => {
  let vaultDir: string
  beforeEach(() => {
    vaultDir = makeTempVault()
  })
  afterEach(() => cleanup(vaultDir))

  it('returns empty array when vault has no projects', () => {
    const vault = loadVault(vaultDir)
    assert.deepEqual(listTasks(vault), [])
  })

  it('returns empty array when project has no actions', () => {
    const vault = loadVault(vaultDir)
    createProject(vault, 'foo')
    assert.deepEqual(listTasks(vault, 'foo'), [])
  })

  it('returns actions across all projects, grouped by slug', () => {
    const vault = loadVault(vaultDir)
    createProject(vault, 'alpha')
    createProject(vault, 'bravo')
    addTask(vault, 'alpha', 'A1')
    addTask(vault, 'alpha', 'A2')
    addTask(vault, 'bravo', 'B1')
    const all = listTasks(vault)
    assert.equal(all.length, 3)
    assert.deepEqual(
      all.map((a) => `${a.slug}#${a.index}:${a.text}`),
      ['alpha#1:A1', 'alpha#2:A2', 'bravo#1:B1'],
    )
  })

  it('filters by project slug when given', () => {
    const vault = loadVault(vaultDir)
    createProject(vault, 'alpha')
    createProject(vault, 'bravo')
    addTask(vault, 'alpha', 'A1')
    addTask(vault, 'bravo', 'B1')
    const filtered = listTasks(vault, 'bravo')
    assert.equal(filtered.length, 1)
    assert.equal(filtered[0].slug, 'bravo')
    assert.equal(filtered[0].text, 'B1')
  })

  it('throws ProjectNotFound when filter slug is unknown', () => {
    const vault = loadVault(vaultDir)
    assert.throws(() => listTasks(vault, 'nope'), ProjectNotFound)
  })
})

describe('actions.addTask', () => {
  let vaultDir: string
  beforeEach(() => {
    vaultDir = makeTempVault()
  })
  afterEach(() => cleanup(vaultDir))

  it('appends to the end of the project actions', () => {
    const vault = loadVault(vaultDir)
    createProject(vault, 'foo')
    const first = addTask(vault, 'foo', 'First')
    assert.equal(first.index, 1)
    assert.equal(first.done, false)
    const second = addTask(vault, 'foo', 'Second')
    assert.equal(second.index, 2)
    const project = readProject(vault, 'foo')
    assert.deepEqual(
      project.tasks.map((a) => a.text),
      ['First', 'Second'],
    )
  })

  it('throws ProjectNotFound for unknown project', () => {
    const vault = loadVault(vaultDir)
    assert.throws(() => addTask(vault, 'nope', 'x'), ProjectNotFound)
  })

  it('stores a due date when provided and round-trips the !YYYY-MM-DD token', () => {
    const vault = loadVault(vaultDir)
    createProject(vault, 'foo')
    const result = addTask(vault, 'foo', 'With deadline', '2026-05-01')
    assert.equal(result.due, '2026-05-01')
    const raw = readFileSync(`${vaultDir}/foo.md`, 'utf8')
    assert.match(raw, /- \[ \] With deadline !2026-05-01/)
    const project = readProject(vault, 'foo')
    assert.equal(project.tasks[0].due, '2026-05-01')
    assert.equal(project.tasks[0].text, 'With deadline')
  })

  it('rejects invalid date format', () => {
    const vault = loadVault(vaultDir)
    createProject(vault, 'foo')
    assert.throws(() => addTask(vault, 'foo', 'x', 'not-a-date'), InvalidDate)
  })
})

describe('actions.completeTask / uncompleteTask', () => {
  let vaultDir: string
  beforeEach(() => {
    vaultDir = makeTempVault()
  })
  afterEach(() => cleanup(vaultDir))

  it('marks task done, moves to Completed lane, and stamps completedAt', () => {
    const vault = loadVault(vaultDir)
    createProject(vault, 'foo')
    addTask(vault, 'foo', 'One')
    const result = completeTask(vault, 'foo#1')
    assert.equal(result.task.done, true)
    assert.equal(result.task.lane, 'completed')
    assert.match(result.task.completedAt ?? '', /^\d{4}-\d{2}-\d{2}$/)
    const onDisk = readProject(vault, 'foo').tasks[0]
    assert.equal(onDisk.done, true)
    assert.equal(onDisk.lane, 'completed')
  })

  it('is idempotent when completing an already-done task', () => {
    const vault = loadVault(vaultDir)
    createProject(vault, 'foo')
    addTask(vault, 'foo', 'One')
    completeTask(vault, 'foo#1')
    const result = completeTask(vault, 'foo#1')
    assert.equal(result.task.done, true)
    assert.equal(result.task.lane, 'completed')
  })

  it('uncompleteTask moves the task back to Available, clears completedAt, and unchecks', () => {
    const vault = loadVault(vaultDir)
    createProject(vault, 'foo')
    addTask(vault, 'foo', 'One')
    completeTask(vault, 'foo#1')
    const result = uncompleteTask(vault, 'foo#1')
    assert.equal(result.task.done, false)
    assert.equal(result.task.lane, 'available')
    assert.equal(result.task.completedAt, undefined)
    const onDisk = readProject(vault, 'foo').tasks[0]
    assert.equal(onDisk.done, false)
    assert.equal(onDisk.lane, 'available')
    assert.equal(onDisk.completedAt, undefined)
  })

  it('throws InvalidRef for malformed ref', () => {
    const vault = loadVault(vaultDir)
    assert.throws(() => completeTask(vault, 'badref'), InvalidRef)
  })

  it('throws ProjectNotFound for unknown project in ref', () => {
    const vault = loadVault(vaultDir)
    assert.throws(() => completeTask(vault, 'nope#1'), ProjectNotFound)
  })

  it('throws IndexOutOfRange for index past end', () => {
    const vault = loadVault(vaultDir)
    createProject(vault, 'foo')
    addTask(vault, 'foo', 'One')
    assert.throws(() => completeTask(vault, 'foo#99'), IndexOutOfRange)
  })
})

describe('actions.removeTask', () => {
  let vaultDir: string
  beforeEach(() => {
    vaultDir = makeTempVault()
  })
  afterEach(() => cleanup(vaultDir))

  it('removes the referenced action and returns it', () => {
    const vault = loadVault(vaultDir)
    createProject(vault, 'foo')
    addTask(vault, 'foo', 'One')
    const result = removeTask(vault, 'foo#1')
    assert.equal(result.task.text, 'One')
    assert.equal(readProject(vault, 'foo').tasks.length, 0)
  })

  it('shifts subsequent indexes down by one', () => {
    const vault = loadVault(vaultDir)
    createProject(vault, 'foo')
    addTask(vault, 'foo', 'One')
    addTask(vault, 'foo', 'Two')
    addTask(vault, 'foo', 'Three')
    removeTask(vault, 'foo#2')
    const remaining = listTasks(vault, 'foo')
    assert.deepEqual(
      remaining.map((a) => `${a.index}:${a.text}`),
      ['1:One', '2:Three'],
    )
  })

  it('reports a shift when the removed task is not last', () => {
    const vault = loadVault(vaultDir)
    createProject(vault, 'foo')
    addTask(vault, 'foo', 'One')
    addTask(vault, 'foo', 'Two')
    addTask(vault, 'foo', 'Three')
    const result = removeTask(vault, 'foo#2')
    assert.deepEqual(result.shift, { slug: 'foo', afterIndex: 2 })
    assert.equal(result.movedFrom, undefined)
  })

  it('omits shift info when the removed task was last', () => {
    const vault = loadVault(vaultDir)
    createProject(vault, 'foo')
    addTask(vault, 'foo', 'One')
    addTask(vault, 'foo', 'Two')
    const result = removeTask(vault, 'foo#2')
    assert.equal(result.shift, undefined)
  })

  it('throws IndexOutOfRange for missing index', () => {
    const vault = loadVault(vaultDir)
    createProject(vault, 'foo')
    assert.throws(() => removeTask(vault, 'foo#1'), IndexOutOfRange)
  })

  it('throws InvalidRef for malformed ref', () => {
    const vault = loadVault(vaultDir)
    assert.throws(() => removeTask(vault, 'no-hash-here'), InvalidRef)
  })
})

describe('actions.editTask', () => {
  let vaultDir: string
  beforeEach(() => {
    vaultDir = makeTempVault()
  })
  afterEach(() => cleanup(vaultDir))

  it('edits title in place', () => {
    const vault = loadVault(vaultDir)
    createProject(vault, 'foo')
    addTask(vault, 'foo', 'Original')
    const result = editTask(vault, 'foo#1', { title: 'Updated' })
    assert.equal(result.task.text, 'Updated')
    assert.equal(result.task.slug, 'foo')
    assert.equal(result.task.index, 1)
    assert.equal(result.shift, undefined)
    assert.equal(result.movedFrom, undefined)
    assert.equal(readProject(vault, 'foo').tasks[0].text, 'Updated')
  })

  it('sets a due date on a task that had none', () => {
    const vault = loadVault(vaultDir)
    createProject(vault, 'foo')
    addTask(vault, 'foo', 'Thing')
    const result = editTask(vault, 'foo#1', { due: '2026-09-09' })
    assert.equal(result.task.due, '2026-09-09')
    assert.equal(readProject(vault, 'foo').tasks[0].due, '2026-09-09')
  })

  it('updates an existing due date', () => {
    const vault = loadVault(vaultDir)
    createProject(vault, 'foo')
    addTask(vault, 'foo', 'Thing', '2026-01-01')
    const result = editTask(vault, 'foo#1', { due: '2027-02-02' })
    assert.equal(result.task.due, '2027-02-02')
  })

  it("clears the due date when --due is ''", () => {
    const vault = loadVault(vaultDir)
    createProject(vault, 'foo')
    addTask(vault, 'foo', 'Thing', '2026-01-01')
    const result = editTask(vault, 'foo#1', { due: '' })
    assert.equal(result.task.due, undefined)
    assert.equal(readProject(vault, 'foo').tasks[0].due, undefined)
  })

  it('rejects invalid date format', () => {
    const vault = loadVault(vaultDir)
    createProject(vault, 'foo')
    addTask(vault, 'foo', 'Thing')
    assert.throws(() => editTask(vault, 'foo#1', { due: 'tomorrow' }), InvalidDate)
  })

  it('moves a task to another project and returns the new ref', () => {
    const vault = loadVault(vaultDir)
    createProject(vault, 'source')
    createProject(vault, 'target')
    addTask(vault, 'source', 'Alpha')
    addTask(vault, 'source', 'Beta')
    addTask(vault, 'target', 'Existing')
    const result = editTask(vault, 'source#1', { project: 'target' })
    assert.equal(result.task.slug, 'target')
    assert.equal(result.task.index, 2)
    assert.equal(result.task.text, 'Alpha')
    assert.equal(result.movedFrom, 'source')
    assert.deepEqual(result.shift, { slug: 'source', afterIndex: 1 })
    // Source project now has just Beta at #1
    const source = readProject(vault, 'source')
    assert.deepEqual(
      source.tasks.map((t) => t.text),
      ['Beta'],
    )
    // Target project now has Existing + Alpha
    const target = readProject(vault, 'target')
    assert.deepEqual(
      target.tasks.map((t) => t.text),
      ['Existing', 'Alpha'],
    )
  })

  it('moving the last task in source reports no shift', () => {
    const vault = loadVault(vaultDir)
    createProject(vault, 'source')
    createProject(vault, 'target')
    addTask(vault, 'source', 'Only')
    const result = editTask(vault, 'source#1', { project: 'target' })
    assert.equal(result.movedFrom, 'source')
    assert.equal(result.shift, undefined)
  })

  it('combines move with title and due edits', () => {
    const vault = loadVault(vaultDir)
    createProject(vault, 'source')
    createProject(vault, 'target')
    addTask(vault, 'source', 'Old title', '2026-01-01')
    const result = editTask(vault, 'source#1', {
      project: 'target',
      title: 'New title',
      due: '2027-03-03',
    })
    assert.equal(result.task.slug, 'target')
    assert.equal(result.task.text, 'New title')
    assert.equal(result.task.due, '2027-03-03')
  })

  it('treats --project equal to source slug as a no-op move', () => {
    const vault = loadVault(vaultDir)
    createProject(vault, 'foo')
    addTask(vault, 'foo', 'One')
    addTask(vault, 'foo', 'Two')
    const result = editTask(vault, 'foo#1', { project: 'foo', title: 'Edited' })
    assert.equal(result.task.slug, 'foo')
    assert.equal(result.task.index, 1)
    assert.equal(result.task.text, 'Edited')
    assert.equal(result.movedFrom, undefined)
    assert.equal(result.shift, undefined)
  })

  it('throws ProjectNotFound for unknown target project (source untouched)', () => {
    const vault = loadVault(vaultDir)
    createProject(vault, 'foo')
    addTask(vault, 'foo', 'Safe')
    assert.throws(
      () => editTask(vault, 'foo#1', { project: 'ghost' }),
      ProjectNotFound,
    )
    assert.equal(readProject(vault, 'foo').tasks.length, 1)
    assert.equal(readProject(vault, 'foo').tasks[0].text, 'Safe')
  })

  it('throws NothingToEdit when no update fields are given', () => {
    const vault = loadVault(vaultDir)
    createProject(vault, 'foo')
    addTask(vault, 'foo', 'One')
    assert.throws(() => editTask(vault, 'foo#1', {}), NothingToEdit)
  })

  it('throws InvalidRef for malformed ref', () => {
    const vault = loadVault(vaultDir)
    assert.throws(() => editTask(vault, 'badref', { title: 'x' }), InvalidRef)
  })

  it('throws IndexOutOfRange for index past end', () => {
    const vault = loadVault(vaultDir)
    createProject(vault, 'foo')
    addTask(vault, 'foo', 'One')
    assert.throws(
      () => editTask(vault, 'foo#99', { title: 'x' }),
      IndexOutOfRange,
    )
  })

  it('persists a due-date edit as an !YYYY-MM-DD suffix on disk', () => {
    const vault = loadVault(vaultDir)
    createProject(vault, 'foo')
    addTask(vault, 'foo', 'Thing')
    editTask(vault, 'foo#1', { due: '2026-08-08' })
    const raw = readFileSync(`${vaultDir}/foo.md`, 'utf8')
    assert.match(raw, /- \[ \] Thing !2026-08-08/)
  })
})
