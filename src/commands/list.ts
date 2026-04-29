import { resolveDataDir } from '../core/config.js'
import { todayLocal } from '../core/dates.js'
import { InvalidArgument } from '../core/errors.js'
import { renderList, type ListType } from '../core/render.js'
import { readStore } from '../core/store.js'

const TYPE_MAP = {
  actions: 'actions',
  projects: 'projects',
  deadlines: 'deadlines',
  waiting: 'waiting',
  memo: 'memos',
} as const

export function listCmd(type: string): string {
  if (!(type in TYPE_MAP)) {
    throw new InvalidArgument(
      `unknown type: ${type} (expected one of: ${Object.keys(TYPE_MAP).join(', ')})`,
    )
  }
  const { dataDir } = resolveDataDir()
  const store = readStore(dataDir)
  return renderList(store, todayLocal(), TYPE_MAP[type as keyof typeof TYPE_MAP] as ListType)
}
