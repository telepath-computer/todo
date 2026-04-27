import {
  activeProjects,
  deferredActions,
  deferredProjects,
  liveActions,
  liveWaiting,
} from '../core/model.js'
import { resolveDataDir } from '../core/config.js'
import { readStore } from '../core/store.js'
import { json } from './shared.js'

export function listCmd(opts: { all?: boolean }): string {
  const { dataDir } = resolveDataDir()
  const store = readStore(dataDir)
  const out: Record<string, unknown> = {
    active_actions: liveActions(store),
    active_projects: activeProjects(store),
    waiting: liveWaiting(store),
  }
  if (opts.all) {
    out.deferred_actions = deferredActions(store)
    out.deferred_projects = deferredProjects(store)
  }
  return json(out)
}

export function listProjectsCmd(): string {
  const { dataDir } = resolveDataDir()
  const store = readStore(dataDir)
  return json({
    active_projects: activeProjects(store),
    deferred_projects: deferredProjects(store),
  })
}
