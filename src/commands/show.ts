import { resolveDataDir } from '../core/config.js'
import { todayLocal } from '../core/dates.js'
import { renderHints } from '../core/hints.js'
import { resolveRef } from '../core/model.js'
import { renderShow } from '../core/render.js'
import { readStore } from '../core/store.js'

export function showCmd(id: string): string {
  const { dataDir } = resolveDataDir()
  const store = readStore(dataDir)
  const today = todayLocal()
  const entity = resolveRef(store, id)
  const hints = entity.type === 'project' ? renderHints(store, today) : undefined
  return renderShow(store, today, entity, hints)
}
