import pc from 'picocolors'
import { resolveVault } from '../core/config.js'
import { listProjectSlugs, readProject } from '../core/project.js'
import { listTasks } from '../core/tasks.js'
import { loadVault } from '../core/vault.js'
import { renderHint } from '../views/atoms.js'
import { renderProjectList, type ProjectSummary } from '../views/project.js'
import { renderAvailableGrouped, renderTaskList } from '../views/task.js'

type ListFlags = {
  all?: boolean
}

export function listCmd(vaultFlag: string | undefined, flags: ListFlags = {}): string {
  const vault = loadVault(resolveVault(vaultFlag))

  const tasksAvail = listTasks(vault, undefined, { lanes: ['available'] })
  const tasksWaiting = listTasks(vault, undefined, { lanes: ['waiting'] })
  const tasksDeferred = flags.all ? listTasks(vault, undefined, { lanes: ['deferred'] }) : []

  const slugs = listProjectSlugs(vault)
  const projects: ProjectSummary[] = slugs.map((slug) => {
    const p = readProject(vault, slug)
    return { slug: p.slug, title: p.title, ...(p.notes ? { notes: p.notes } : {}) }
  })

  const blocks: string[] = []
  blocks.push(
    `${pc.bold('Tasks:')}\n\n${tasksAvail.length > 0 ? renderAvailableGrouped(tasksAvail) : pc.dim('<none>')}`,
  )
  blocks.push(`${pc.bold('Waiting:')}\n\n${tasksWaiting.length > 0 ? renderTaskList(tasksWaiting) : pc.dim('<none>')}`)
  if (flags.all) {
    blocks.push(
      `${pc.bold('Deferred:')}\n\n${tasksDeferred.length > 0 ? renderTaskList(tasksDeferred) : pc.dim('<none>')}`,
    )
  }
  blocks.push(
    `${pc.bold('Projects:')}\n\n${projects.length > 0 ? renderProjectList(projects) : pc.dim('<none>')}`,
  )

  // Empty-vault hint when nothing exists at all (TTY only).
  const empty =
    tasksAvail.length === 0 &&
    tasksWaiting.length === 0 &&
    tasksDeferred.length === 0 &&
    projects.length === 0
  if (empty) {
    if (!process.stdout.isTTY) return ''
    return renderHint('Nothing yet. Start with: todo projects add <slug>')
  }

  return blocks.join('\n\n')
}
