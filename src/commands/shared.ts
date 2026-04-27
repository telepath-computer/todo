import { stableStringify } from '../core/store.js'

export function json(value: unknown): string {
  return stableStringify(value)
}
