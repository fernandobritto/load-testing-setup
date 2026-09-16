import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

let counter = 0

/** Collision-safe id generator that also works outside secure contexts */
export function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  counter += 1
  return `id-${Date.now().toString(36)}-${counter.toString(36)}`
}

export function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

/** k6 duration strings: 30s, 5m, 1h30m, 500ms … */
const DURATION_RE = /^(\d+(\.\d+)?(h|m|s|ms))+$/

export function isValidDuration(value: string): boolean {
  return DURATION_RE.test(value.trim())
}

const DURATION_PART_RE = /(\d+(?:\.\d+)?)(h|m|s|ms)/g

/** Parses a k6 duration string (e.g. "1h30m", "500ms") into seconds. */
export function parseDurationSeconds(value: string): number {
  const trimmed = value.trim()
  if (trimmed === '') return 0
  const unit: Record<string, number> = { h: 3600, m: 60, s: 1, ms: 0.001 }
  let total = 0
  let matched = false
  for (const match of trimmed.matchAll(DURATION_PART_RE)) {
    matched = true
    total += Number(match[1]) * (unit[match[2]] ?? 0)
  }
  return matched ? total : 0
}

/** Formats seconds back into a compact human duration (e.g. 5400 → "1h30m"). */
export function formatDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return '0s'
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = Math.round(totalSeconds % 60)
  return (
    [hours > 0 ? `${hours}h` : '', minutes > 0 ? `${minutes}m` : '', seconds > 0 ? `${seconds}s` : '']
      .join('')
      .trim() || '0s'
  )
}

export function tryParseJson(value: string): { ok: boolean; error?: string } {
  try {
    JSON.parse(value)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Invalid JSON' }
  }
}
