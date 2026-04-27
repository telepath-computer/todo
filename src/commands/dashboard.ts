import { resolveDataDir } from '../core/config.js'
import { todayLocal } from '../core/dates.js'
import { renderHints } from '../core/hints.js'
import { renderDashboard } from '../core/render.js'
import { readStore } from '../core/store.js'

export function dashboardCmd(): string {
  const { dataDir } = resolveDataDir()
  const store = readStore(dataDir)
  const today = todayLocal()
  return renderDashboard(store, today, renderHints(store, today))
}
