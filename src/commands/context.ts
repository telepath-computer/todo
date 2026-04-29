import { resolveDataDir } from '../core/config.js'
import { InvalidArgument } from '../core/errors.js'
import { appendStoreContext, setStoreContext } from '../core/model.js'
import { renderContextBlock } from '../core/render.js'
import { readStore, writeStore } from '../core/store.js'
import { json } from './shared.js'

export type ContextCmdOpts = {
  append?: string
}

export function contextCmd(text: string | undefined, opts: ContextCmdOpts = {}): string {
  if (text !== undefined && opts.append !== undefined) {
    throw new InvalidArgument('positional <text> and --append are mutually exclusive')
  }

  const { dataDir } = resolveDataDir()
  const store = readStore(dataDir)

  if (text === undefined && opts.append === undefined) {
    return renderContextBlock(store)
  }

  let next = store
  if (opts.append !== undefined) {
    next = appendStoreContext(store, opts.append)
  } else if (text !== undefined) {
    next = setStoreContext(store, text === '' ? null : text)
  }
  writeStore(dataDir, next)
  return json({ context: next.meta.context })
}
