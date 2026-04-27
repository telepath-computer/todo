import { resolveDataDir } from '../core/config.js'
import { resolveRef } from '../core/model.js'
import { readStore } from '../core/store.js'
import { json } from './shared.js'

export function showCmd(id: string): string {
  const { dataDir } = resolveDataDir()
  const store = readStore(dataDir)
  return json(resolveRef(store, id))
}
