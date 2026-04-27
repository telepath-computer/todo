import { resolveVault } from '../core/config.js'
import {
  createProject,
  editProject,
  listProjectSlugs,
  readProject,
  removeProject,
} from '../core/project.js'
import { loadVault } from '../core/vault.js'
import { renderHint } from '../views/atoms.js'
import {
  renderProjectHeading,
  renderProjectList,
  renderProjectShow,
} from '../views/project.js'

export function listProjectsCmd(vaultFlag: string | undefined): string {
  const vault = loadVault(resolveVault(vaultFlag))
  const slugs = listProjectSlugs(vault)
  if (slugs.length === 0) {
    return process.stdout.isTTY
      ? renderHint('No projects. Create one with: todo projects add <slug>')
      : ''
  }
  const projects = slugs.map((slug) => {
    const p = readProject(vault, slug)
    return { slug: p.slug, title: p.title }
  })
  return renderProjectList(projects)
}

export function addProjectCmd(
  vaultFlag: string | undefined,
  slug: string,
  title: string | undefined,
  notes: string | undefined,
): string {
  const vault = loadVault(resolveVault(vaultFlag))
  const project = createProject(vault, slug, title, notes)
  return renderProjectHeading('Created new project.', {
    slug: project.slug,
    title: project.title,
    notes: project.notes,
  })
}

export function showProjectCmd(vaultFlag: string | undefined, slug: string): string {
  const vault = loadVault(resolveVault(vaultFlag))
  const project = readProject(vault, slug)
  return renderProjectShow(project)
}

export function removeProjectCmd(vaultFlag: string | undefined, slug: string): string {
  const vault = loadVault(resolveVault(vaultFlag))
  const project = removeProject(vault, slug)
  return `Removed project: ${project.slug}.`
}

export function editProjectCmd(
  vaultFlag: string | undefined,
  slug: string,
  updates: { title?: string; notes?: string },
): string {
  const vault = loadVault(resolveVault(vaultFlag))
  const project = editProject(vault, slug, updates)
  return renderProjectHeading('Updated project.', {
    slug: project.slug,
    title: project.title,
    notes: project.notes,
  })
}
