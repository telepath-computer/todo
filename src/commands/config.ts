import { resolveDataDir, writeConfig } from '../core/config.js'
import { json } from './shared.js'

export function setDataDirCmd(path: string): string {
  writeConfig({ dataDir: path })
  return json(resolveDataDir())
}

export function configCmd(): string {
  return json(resolveDataDir())
}
