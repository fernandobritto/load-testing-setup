import type { ExecutorConfig, ExecutorType } from '@/lib/dsl/types'

export type ExecutorFieldKey =
  | 'vus'
  | 'iterations'
  | 'maxDuration'
  | 'duration'
  | 'startVUs'
  | 'stages'
  | 'gracefulRampDown'
  | 'rate'
  | 'startRate'
  | 'timeUnit'
  | 'preAllocatedVUs'
  | 'maxVUs'

export interface ExecutorFieldMeta {
  key: ExecutorFieldKey
  label: string
  kind: 'number' | 'duration' | 'stages'
  required: boolean
  help: string
}

export interface ExecutorMeta {
  type: ExecutorType
  label: string
  category: 'iteration-based' | 'vu-based' | 'arrival-rate' | 'external'
  summary: string
  whenToUse: string
  fields: ExecutorFieldMeta[]
}

const F = (
  key: ExecutorFieldKey,
  label: string,
  kind: ExecutorFieldMeta['kind'],
  required: boolean,
  help: string
): ExecutorFieldMeta => ({ key, label, kind, required, help })

/**
 * Every official k6 executor and its documented options.
 * https://grafana.com/docs/k6/latest/using-k6/scenarios/executors/
 */
export const EXECUTORS: ExecutorMeta[] = [
  {
    type: 'shared-iterations',
    label: 'Shared Iterations',
    category: 'iteration-based',
    summary: 'A fixed total number of iterations shared between all VUs.',
    whenToUse:
      'Use when you need a fixed amount of total work done (e.g. process 1,000 records) and do not care which VU does it. Fastest VUs complete more iterations.',
    fields: [
      F('vus', 'VUs', 'number', false, 'Number of VUs to run concurrently. Default: 1.'),
      F(
        'iterations',
        'Total iterations',
        'number',
        false,
        'Total iterations shared across all VUs. Default: 1.'
      ),
      F(
        'maxDuration',
        'Max duration',
        'duration',
        false,
        'Hard limit before the scenario is forcibly stopped. Default: 10m.'
      )
    ]
  },
  {
    type: 'per-vu-iterations',
    label: 'Per-VU Iterations',
    category: 'iteration-based',
    summary: 'Each VU executes an exact number of iterations.',
    whenToUse:
      'Use when every VU must perform the same amount of work — e.g. each virtual user processes its own partition of test data.',
    fields: [
      F('vus', 'VUs', 'number', false, 'Number of VUs to run concurrently. Default: 1.'),
      F(
        'iterations',
        'Iterations per VU',
        'number',
        false,
        'Iterations each individual VU executes. Default: 1.'
      ),
      F(
        'maxDuration',
        'Max duration',
        'duration',
        false,
        'Hard limit before the scenario is forcibly stopped. Default: 10m.'
      )
    ]
  },
  {
    type: 'constant-vus',
    label: 'Constant VUs',
    category: 'vu-based',
    summary: 'A fixed number of VUs run as many iterations as possible for a set time.',
    whenToUse:
      'The workhorse for simple load tests: keep N concurrent users hammering the system for a fixed duration.',
    fields: [
      F('vus', 'VUs', 'number', false, 'Number of concurrent VUs. Default: 1.'),
      F('duration', 'Duration', 'duration', true, 'Total scenario execution time, e.g. 10m.')
    ]
  },
  {
    type: 'ramping-vus',
    label: 'Ramping VUs',
    category: 'vu-based',
    summary: 'The number of VUs ramps up and down according to configurable stages.',
    whenToUse:
      'The standard choice for load, stress, spike and soak tests — ramp traffic up gradually, hold, then ramp down to observe recovery.',
    fields: [
      F('startVUs', 'Start VUs', 'number', false, 'VUs to run at test start. Default: 1.'),
      F('stages', 'Stages', 'stages', true, 'Array of { duration, target } steps to ramp the VU count.'),
      F(
        'gracefulRampDown',
        'Graceful ramp-down',
        'duration',
        false,
        'Time to wait for iterations to finish before killing VUs on ramp-down. Default: 30s.'
      )
    ]
  },
  {
    type: 'constant-arrival-rate',
    label: 'Constant Arrival Rate',
    category: 'arrival-rate',
    summary: 'Iterations start at a fixed rate, independent of system response time.',
    whenToUse:
      'Use to test throughput in requests-per-second terms. Because the rate is independent of the target’s response time, it avoids the coordinated-omission problem.',
    fields: [
      F('rate', 'Rate', 'number', true, 'Number of iterations to start per timeUnit.'),
      F('timeUnit', 'Time unit', 'duration', false, 'Period the rate applies to. Default: 1s.'),
      F('duration', 'Duration', 'duration', true, 'Total scenario execution time.'),
      F(
        'preAllocatedVUs',
        'Pre-allocated VUs',
        'number',
        true,
        'VUs pre-initialized before the test starts.'
      ),
      F('maxVUs', 'Max VUs', 'number', false, 'Maximum VUs allowed if pre-allocated VUs are insufficient.')
    ]
  },
  {
    type: 'ramping-arrival-rate',
    label: 'Ramping Arrival Rate',
    category: 'arrival-rate',
    summary: 'The iteration start-rate ramps up or down according to stages.',
    whenToUse:
      'Use for breakpoint and capacity tests: steadily increase request throughput until the system degrades, regardless of how slow responses get.',
    fields: [
      F('startRate', 'Start rate', 'number', false, 'Iterations per timeUnit at test start. Default: 0.'),
      F('timeUnit', 'Time unit', 'duration', false, 'Period the rate applies to. Default: 1s.'),
      F('stages', 'Stages', 'stages', true, 'Array of { duration, target } steps to ramp the arrival rate.'),
      F(
        'preAllocatedVUs',
        'Pre-allocated VUs',
        'number',
        true,
        'VUs pre-initialized before the test starts.'
      ),
      F('maxVUs', 'Max VUs', 'number', false, 'Maximum VUs allowed if pre-allocated VUs are insufficient.')
    ]
  },
  {
    type: 'externally-controlled',
    label: 'Externally Controlled',
    category: 'external',
    summary: 'Execution is controlled at runtime via the k6 REST API or CLI.',
    whenToUse:
      'Use when an external system (or a human) needs to pause, resume, and scale the test while it runs — e.g. k6 pause / k6 scale.',
    fields: [
      F('vus', 'Initial VUs', 'number', false, 'VUs to run at test start. Can be changed at runtime.'),
      F('maxVUs', 'Max VUs', 'number', true, 'Upper limit the test can be scaled up to at runtime.'),
      F('duration', 'Duration', 'duration', true, 'Total scenario execution time.')
    ]
  }
]

export function executorMeta(type: ExecutorType): ExecutorMeta {
  const meta = EXECUTORS.find((e) => e.type === type)
  if (meta === undefined) throw new Error(`Unknown executor: ${type}`)
  return meta
}

/** Fields of ExecutorConfig that are actually emitted for a given executor type */
export function activeFields(type: ExecutorType): ExecutorFieldKey[] {
  return executorMeta(type).fields.map((f) => f.key)
}

/** Peak concurrency implied by a config — used for sanity warnings */
export function peakVUs(config: ExecutorConfig): number {
  switch (config.type) {
    case 'ramping-vus':
      return Math.max(config.startVUs, ...config.stages.map((s) => s.target))
    case 'constant-arrival-rate':
    case 'ramping-arrival-rate':
      return config.maxVUs > 0 ? config.maxVUs : config.preAllocatedVUs
    case 'externally-controlled':
      return config.maxVUs
    default:
      return config.vus
  }
}
