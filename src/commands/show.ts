import { resolveDataDir } from '../core/config.js'
import { todayLocal } from '../core/dates.js'
import { resolveRef } from '../core/model.js'
import { renderShow } from '../core/render.js'
import { readStore } from '../core/store.js'

export function showCmd(id: string): string {
  const { dataDir } = resolveDataDir()
  const store = readStore(dataDir)
  const today = todayLocal()
  const entity = resolveRef(store, id)
  return renderShow(store, today, entity)
}
