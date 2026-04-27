import { resolveDataDir } from '../core/config.js'
import { todayLocal } from '../core/dates.js'
import {
  projectActiveActions,
  projectDeadlines,
  projectDeferredActions,
  projectWaiting,
  resolveRef,
} from '../core/model.js'
import { readStore } from '../core/store.js'
import { json } from './shared.js'

export function showCmd(id: string): string {
  const { dataDir } = resolveDataDir()
  const store = readStore(dataDir)
  const entity = resolveRef(store, id)
  if (entity.type === 'project') {
    const today = todayLocal()
    return json({
      ...entity,
      active_actions: projectActiveActions(store, today, entity.id),
      deferred_actions: projectDeferredActions(store, today, entity.id),
      deadlines: projectDeadlines(store, today, entity.id),
      waiting: projectWaiting(store, entity.id),
    })
  }
  return json(entity)
}
