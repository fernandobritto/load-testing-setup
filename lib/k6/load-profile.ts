import type { ExecutorConfig } from '@/lib/dsl/types'
import { parseDurationSeconds } from '@/lib/utils'

export interface LoadPoint {
  /** Seconds since the scenario started. */
  t: number
  /** VUs, or iterations per timeUnit for arrival-rate executors. */
  v: number
}

export interface LoadProfile {
  points: LoadPoint[]
  /** What `v` counts, e.g. `VUs` or `iters/1s`. */
  unit: string
  /** Human name of the shape, e.g. `ramping VUs`. */
  kind: string
  /** Total wall-clock seconds the scenario occupies. */
  duration: number
  /** Highest value the scenario reaches. */
  peak: number
}

/**
 * The load-over-time shape of an executor.
 *
 * One implementation feeds the ramp chart, the scenario cards and the suite
 * timeline, so a scenario's duration and peak are never computed two ways.
 */
export function loadProfile(config: ExecutorConfig): LoadProfile {
  const build = (points: LoadPoint[], unit: string, kind: string): LoadProfile => ({
    points,
    unit,
    kind,
    duration: Math.max(...points.map((point) => point.t), 0),
    peak: Math.max(...points.map((point) => point.v), 0)
  })

  const staged = (start: number, unit: string, kind: string): LoadProfile => {
    const points: LoadPoint[] = [{ t: 0, v: start }]
    let t = 0
    for (const stage of config.stages) {
      t += parseDurationSeconds(stage.duration)
      points.push({ t, v: stage.target })
    }
    return build(points, unit, kind)
  }

  const flat = (value: number, seconds: number, unit: string, kind: string): LoadProfile =>
    build(
      [
        { t: 0, v: value },
        { t: seconds, v: value }
      ],
      unit,
      kind
    )

  switch (config.type) {
    case 'ramping-vus':
      return staged(config.startVUs, 'VUs', 'ramping VUs')
    case 'ramping-arrival-rate':
      return staged(config.startRate, `iters/${config.timeUnit}`, 'ramping arrival rate')
    case 'constant-vus':
      return flat(config.vus, parseDurationSeconds(config.duration), 'VUs', 'constant VUs')
    case 'constant-arrival-rate':
      return flat(
        config.rate,
        parseDurationSeconds(config.duration),
        `iters/${config.timeUnit}`,
        'constant arrival rate'
      )
    case 'externally-controlled':
      return flat(config.vus, parseDurationSeconds(config.duration), 'VUs', 'externally controlled')
    case 'shared-iterations':
    case 'per-vu-iterations':
      /* Iteration-based executors have no ramp: show a flat band bounded by
         maxDuration, which is the only time limit they declare. */
      return flat(config.vus, parseDurationSeconds(config.maxDuration) || 1, 'VUs', 'iterations')
  }
}
