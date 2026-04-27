import { InvalidRef } from './errors.js'

export type Ref = { slug: string; index: number }

export function parseRef(ref: string): Ref {
  const hashIdx = ref.lastIndexOf('#')
  if (hashIdx === -1) throw new InvalidRef(ref)
  const slug = ref.slice(0, hashIdx)
  const indexStr = ref.slice(hashIdx + 1)
  if (slug.length === 0 || indexStr.length === 0) throw new InvalidRef(ref)
  if (!/^\d+$/.test(indexStr)) throw new InvalidRef(ref)
  const index = Number(indexStr)
  if (index < 1) throw new InvalidRef(ref)
  return { slug, index }
}

export function formatRef(slug: string, index: number): string {
  return `${slug}#${index}`
}
