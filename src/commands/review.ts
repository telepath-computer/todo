import { resolveDataDir } from '../core/config.js'
import { todayLocal } from '../core/dates.js'
import { renderHints } from '../core/hints.js'
import { renderReview } from '../core/render.js'
import { readStore } from '../core/store.js'

export function reviewCmd(): string {
  const { dataDir } = resolveDataDir()
  const store = readStore(dataDir)
  const today = todayLocal()
  return renderReview(store, today, renderHints(store, today, 'review'))
}
