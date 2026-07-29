import {
  createExecutorConfig,
  createKeyValue,
  createScenario,
  createStage,
  createThreshold
} from '@/lib/dsl/defaults'
import type { ExecutorConfig, KeyValue, ScenarioDef, ScenarioTypeId, ThresholdDef } from '@/lib/dsl/types'
import { uid } from '@/lib/utils'

export type { ScenarioTypeId }

/**
 * The catalogue of workload shapes a performance suite can contain.
 *
 * A project is a *suite of scenarios*, not a single test: the same journey is
 * normally measured as smoke, load, stress, spike, soak … each answering a
 * different question. Every entry here is a template — executor, ramp, quality
 * gates, tags and educational copy — applied when the scenario is created and
 * fully editable afterwards.
 *
 * Adding a type is a data change only: nothing in the UI switches on the id.
 */
export interface ScenarioType {
  id: ScenarioTypeId
  label: string
  /** Key into the icon map in components/shared/scenario-type-icon.tsx */
  icon: string
  /** CSS variable holding this type's accent colour (defined in globals.css). */
  color: string
  /** One line, shown on the card. */
  tagline: string
  /** The plain-language definition of the type, shown in pickers and panels. */
  summary: string
  /** The deeper explanation, shown on demand. */
  description: string
  /** The question a run of this type answers. */
  answers: string
  /** What to look at in the results. */
  watchFor: string
  /**
   * Position in a canonical performance campaign: cheap gates first, multi-hour
   * runs last. Drives scenario ordering and the run order of the export.
   */
  order: number
  /** Rough wall-clock cost of one run, shown in the picker and generated docs. */
  approxDuration: string
  /** Runs for hours — kept out of the default `quick` chain and compose profile. */
  longRunning: boolean
  buildExecutor: () => ExecutorConfig
  buildThresholds: () => ThresholdDef[]
  /** Metric tags every sample of this scenario carries. */
  buildTags: () => KeyValue[]
}

const threshold = (
  metric: string,
  aggregation: ThresholdDef['aggregation'],
  operator: ThresholdDef['operator'],
  value: string,
  abortOnFail = false
): ThresholdDef => ({ ...createThreshold(metric), id: uid(), aggregation, operator, value, abortOnFail })

/** Every scenario is tagged with its type so results stay separable per workload. */
const typeTag = (id: ScenarioTypeId): KeyValue[] => [createKeyValue('test_type', id)]

/**
 * Load-test types as documented by Grafana k6.
 * https://grafana.com/docs/k6/latest/testing-guides/test-types/
 */
export const SCENARIO_TYPES: ScenarioType[] = [
  {
    id: 'smoke',
    label: 'Smoke Test',
    icon: 'flame',
    color: 'var(--type-smoke)',
    tagline: 'Minimal load, verify the script and system work at all',
    summary:
      'Runs a minimal workload to verify that the application and the script are functioning correctly.',
    description:
      'Runs the journey with a couple of VUs for a short time. Run it after every script change and before any bigger scenario — there is no point stress-testing a broken script.',
    answers: 'Does the script work and the system respond correctly at all?',
    watchFor: 'Any failed check or non-2xx response. At this load nothing may fail.',
    order: 1,
    approxDuration: '~1 min',
    longRunning: false,
    buildExecutor: () => ({
      ...createExecutorConfig('constant-vus'),
      vus: 2,
      duration: '1m'
    }),
    buildThresholds: () => [
      threshold('http_req_duration', 'p(95)', '<', '1000'),
      threshold('http_req_failed', 'rate', '<', '0.01'),
      threshold('checks', 'rate', '==', '1')
    ],
    buildTags: () => typeTag('smoke')
  },
  {
    id: 'load',
    label: 'Load Test',
    icon: 'trending-up',
    color: 'var(--type-load)',
    tagline: 'Average expected traffic for a sustained period',
    summary: 'Simulates the expected production traffic for a sustained period.',
    description:
      'Assesses behaviour under typical production load: ramp up to the expected number of concurrent users, hold, then ramp down and observe recovery.',
    answers: 'Does the system meet its SLOs under normal expected traffic?',
    watchFor: 'p(95) latency drifting upwards during the plateau — that is a leak or a saturating resource.',
    order: 2,
    approxDuration: '~40 min',
    longRunning: false,
    buildExecutor: () => ({
      ...createExecutorConfig('ramping-vus'),
      startVUs: 0,
      stages: [createStage('5m', 100), createStage('30m', 100), createStage('5m', 0)],
      gracefulRampDown: '30s'
    }),
    buildThresholds: () => [
      threshold('http_req_duration', 'p(95)', '<', '500'),
      threshold('http_req_failed', 'rate', '<', '0.01')
    ],
    buildTags: () => typeTag('load')
  },
  {
    id: 'stress',
    label: 'Stress Test',
    icon: 'gauge',
    color: 'var(--type-stress)',
    tagline: 'Above-normal load to find degradation behaviour',
    summary: 'Pushes the system beyond normal capacity to identify degradation.',
    description:
      'Pushes the system beyond expected peaks to learn how it degrades: do errors rise gracefully or does it collapse? Ramps to roughly 2× the normal load and holds.',
    answers: 'How does the system degrade when traffic exceeds the expected peak?',
    watchFor: 'Whether errors climb smoothly or the system falls off a cliff, and whether it recovers.',
    order: 3,
    approxDuration: '~45 min',
    longRunning: false,
    buildExecutor: () => ({
      ...createExecutorConfig('ramping-vus'),
      startVUs: 0,
      stages: [createStage('10m', 200), createStage('30m', 200), createStage('5m', 0)],
      gracefulRampDown: '30s'
    }),
    buildThresholds: () => [
      threshold('http_req_duration', 'p(95)', '<', '1000'),
      threshold('http_req_failed', 'rate', '<', '0.05')
    ],
    buildTags: () => typeTag('stress')
  },
  {
    id: 'spike',
    label: 'Spike Test',
    icon: 'zap',
    color: 'var(--type-spike)',
    tagline: 'Sudden massive surge, then rapid drop',
    summary: 'Introduces sudden traffic spikes to evaluate resilience.',
    description:
      'Simulates flash-sale or breaking-news traffic: a near-instant jump to extreme concurrency with no ramp. Verifies autoscaling, queue shedding and recovery.',
    answers: 'Does the system survive — and recover from — a sudden traffic surge?',
    watchFor: 'Time to recover after the drop. A system that never returns to baseline has a queue problem.',
    order: 4,
    approxDuration: '~5 min',
    longRunning: false,
    buildExecutor: () => ({
      ...createExecutorConfig('ramping-vus'),
      startVUs: 0,
      stages: [createStage('1m', 500), createStage('3m', 500), createStage('1m', 0)],
      gracefulRampDown: '15s'
    }),
    buildThresholds: () => [threshold('http_req_failed', 'rate', '<', '0.1')],
    buildTags: () => typeTag('spike')
  },
  {
    id: 'capacity',
    label: 'Capacity Test',
    icon: 'bar-chart-3',
    color: 'var(--type-capacity)',
    tagline: 'Step the throughput to measure sustainable RPS',
    summary: 'Measures the maximum sustainable throughput before performance degrades.',
    description:
      'Ramps request rate in plateaus to determine the maximum throughput the system sustains within SLOs. Read the results as: the last plateau that met its thresholds is your certified capacity.',
    answers: 'How many requests per second can we sustain within our SLOs?',
    watchFor: 'The plateau where p(95) crosses the SLO — the previous one is your certified capacity.',
    order: 5,
    approxDuration: '~22 min',
    longRunning: false,
    buildExecutor: () => ({
      ...createExecutorConfig('ramping-arrival-rate'),
      startRate: 50,
      timeUnit: '1s',
      stages: [
        createStage('5m', 50),
        createStage('5m', 100),
        createStage('5m', 150),
        createStage('5m', 200),
        createStage('2m', 0)
      ],
      preAllocatedVUs: 200,
      maxVUs: 400
    }),
    buildThresholds: () => [
      threshold('http_req_duration', 'p(95)', '<', '500'),
      threshold('http_req_failed', 'rate', '<', '0.01')
    ],
    buildTags: () => typeTag('capacity')
  },
  {
    id: 'breakpoint',
    label: 'Breakpoint Test',
    icon: 'activity',
    color: 'var(--type-breakpoint)',
    tagline: 'Ramp until the system breaks to find its limit',
    summary: 'Gradually increases load until the application reaches its breaking point.',
    description:
      'Steadily increases arrival rate far beyond expectations until the system fails, to find the exact breaking point. Uses ramping-arrival-rate so throughput keeps rising even as responses slow down; aborts automatically once the error threshold is crossed.',
    answers: 'At exactly what load does the system break?',
    watchFor: 'The arrival rate at the moment the abort fires — that number is your breaking point.',
    order: 6,
    approxDuration: 'up to 2 hours (aborts at the breaking point)',
    longRunning: true,
    buildExecutor: () => ({
      ...createExecutorConfig('ramping-arrival-rate'),
      startRate: 0,
      timeUnit: '1s',
      stages: [createStage('2h', 2000)],
      preAllocatedVUs: 500,
      maxVUs: 2000
    }),
    buildThresholds: () => [threshold('http_req_failed', 'rate', '<', '0.05', true)],
    buildTags: () => typeTag('breakpoint')
  },
  {
    id: 'soak',
    label: 'Soak Test',
    icon: 'clock',
    color: 'var(--type-soak)',
    tagline: 'Average load held for hours to expose leaks',
    summary:
      'Executes a long-running workload to identify memory leaks, resource exhaustion and long-term stability issues.',
    description:
      'Holds normal load for an extended period (hours) to reveal slow failure modes: memory leaks, connection-pool exhaustion, disk fill-up, degrading caches.',
    answers: 'Does reliability degrade when normal load is sustained for hours?',
    watchFor: 'A slow upward trend in latency or errors over hours, with load held perfectly flat.',
    order: 7,
    approxDuration: '~4 hours',
    longRunning: true,
    buildExecutor: () => ({
      ...createExecutorConfig('ramping-vus'),
      startVUs: 0,
      stages: [createStage('5m', 100), createStage('4h', 100), createStage('5m', 0)],
      gracefulRampDown: '30s'
    }),
    buildThresholds: () => [
      threshold('http_req_duration', 'p(95)', '<', '500'),
      threshold('http_req_failed', 'rate', '<', '0.01')
    ],
    buildTags: () => typeTag('soak')
  },
  {
    id: 'custom',
    label: 'Custom Scenario',
    icon: 'sliders',
    color: 'var(--type-custom)',
    tagline: 'Shape the workload yourself',
    summary: 'A blank workload you configure from scratch — any executor, any ramp, any gates.',
    description:
      'Starts from a modest constant-VU workload with no assumptions baked in. Use it for anything the canonical types do not cover: a login benchmark, a single-endpoint regression guard, a background writer running alongside another scenario.',
    answers: 'Whatever question you design it to answer.',
    watchFor: 'Whichever metric this workload exists to protect — give it an explicit threshold.',
    order: 8,
    approxDuration: '~5 min',
    longRunning: false,
    buildExecutor: () => ({
      ...createExecutorConfig('constant-vus'),
      vus: 10,
      duration: '5m'
    }),
    buildThresholds: () => [
      threshold('http_req_duration', 'p(95)', '<', '500'),
      threshold('http_req_failed', 'rate', '<', '0.01')
    ],
    buildTags: () => typeTag('custom')
  }
]

/**
 * A scenario configured from its type template: executor, ramp, quality gates
 * and metric tags. Everything stays editable afterwards — the template only
 * decides where the user starts.
 */
export function buildScenario(typeId: ScenarioTypeId, name?: string): ScenarioDef {
  const type = scenarioType(typeId)
  return {
    ...createScenario(name ?? typeId),
    typeId,
    description: type.summary,
    executor: type.buildExecutor(),
    thresholds: type.buildThresholds(),
    tags: type.buildTags()
  }
}

export function scenarioType(id: ScenarioTypeId): ScenarioType {
  const found = SCENARIO_TYPES.find((type) => type.id === id)
  if (found === undefined) throw new Error(`Unknown scenario type: ${id}`)
  return found
}

export function maybeScenarioType(id: ScenarioTypeId | null | undefined): ScenarioType | undefined {
  return id === null || id === undefined ? undefined : SCENARIO_TYPES.find((type) => type.id === id)
}

/** Every type in canonical campaign order. */
export const SCENARIO_TYPES_IN_ORDER: ScenarioType[] = [...SCENARIO_TYPES].sort((a, b) => a.order - b.order)

/** Campaign position of a scenario; unknown types sort last. */
export function scenarioTypeOrder(id: ScenarioTypeId | null | undefined): number {
  return maybeScenarioType(id)?.order ?? Number.MAX_SAFE_INTEGER
}

/** Orders types the way a campaign runs them: cheap gates first, soaks last. */
export function sortScenarioTypeIds(ids: ScenarioTypeId[]): ScenarioTypeId[] {
  return [...ids].sort((a, b) => scenarioTypeOrder(a) - scenarioTypeOrder(b))
}

/**
 * Curated combinations. Real performance repos hold several scenarios, and these
 * are the sets teams actually ship together — offering them as one click is
 * faster and safer than expecting everyone to know which types pair.
 */
export interface ScenarioBundle {
  id: string
  label: string
  description: string
  typeIds: ScenarioTypeId[]
}

export const SCENARIO_BUNDLES: ScenarioBundle[] = [
  {
    id: 'essentials',
    label: 'Essentials',
    description: 'Prove the script works, then measure normal traffic. The baseline every suite needs.',
    typeIds: ['smoke', 'load']
  },
  {
    id: 'release-gate',
    label: 'Release gate',
    description: 'Smoke, average load and stress — enough evidence to sign off a release.',
    typeIds: ['smoke', 'load', 'stress']
  },
  {
    id: 'capacity-planning',
    label: 'Capacity planning',
    description: 'Find the ceiling: sustainable throughput plus the exact breaking point.',
    typeIds: ['smoke', 'capacity', 'breakpoint']
  },
  {
    id: 'resilience',
    label: 'Resilience',
    description: 'Traffic that misbehaves: a sudden surge and a multi-hour soak for slow leaks.',
    typeIds: ['smoke', 'spike', 'soak']
  },
  {
    id: 'full-sweep',
    label: 'Full sweep',
    description: 'Every canonical k6 test type in one suite.',
    typeIds: SCENARIO_TYPES_IN_ORDER.filter((type) => type.id !== 'custom').map((type) => type.id)
  }
]
