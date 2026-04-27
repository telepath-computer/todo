import { resolveDataDir } from '../core/config.js'
import { todayLocal } from '../core/dates.js'
import { InvalidArgument } from '../core/errors.js'
import { renderList, type ListType } from '../core/render.js'
import { readStore } from '../core/store.js'

const VALID_TYPES: readonly ListType[] = ['actions', 'projects', 'deadlines', 'waiting'] as const

export function listCmd(type: string): string {
  if (!VALID_TYPES.includes(type as ListType)) {
    throw new InvalidArgument(
      `unknown type: ${type} (expected one of: ${VALID_TYPES.join(', ')})`,
    )
  }
  const { dataDir } = resolveDataDir()
  const store = readStore(dataDir)
  return renderList(store, todayLocal(), type as ListType)
}
