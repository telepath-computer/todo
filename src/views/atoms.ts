import pc from 'picocolors'
import { formatRef } from '../core/ref.js'

export function renderCheckbox(done: boolean): string {
  return pc.blue(done ? '[x]' : '[ ]')
}

// 256-colour orangey-red (xterm 202). Falls back to plain when colour is disabled.
export function orangeRed(s: string): string {
  return pc.isColorSupported ? `\x1b[38;5;202m${s}\x1b[39m` : s
}

export function renderRef(slug: string, index: number): string {
  return pc.dim(`[${formatRef(slug, index)}]`)
}

export function renderError(message: string): string {
  return pc.red(`error: ${message}`)
}

export function renderHint(message: string): string {
  return pc.dim(message)
}
