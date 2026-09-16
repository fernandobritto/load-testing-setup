/**
 * Internal DSL / AST for the K6 Visual Script Builder.
 *
 * This model is the single source of truth between the visual builder,
 * the validation engine and the JavaScript generator:
 *
 *   Visual Builder → TestPlan (this DSL) → Validation Engine → JS Generator → Export
 */

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

export interface KeyValue {
  id: string
  key: string
  value: string
  enabled: boolean
}

export type BodyMode = 'none' | 'json' | 'text' | 'form-urlencoded' | 'multipart'

export interface RequestBody {
  mode: BodyMode
  /** Raw content for json / text modes */
  raw: string
  /** Fields for form-urlencoded / multipart modes */
  fields: KeyValue[]
}

export type AuthConfig =
  | { type: 'none' }
  | { type: 'bearer'; token: string }
  | { type: 'basic'; username: string; password: string }
  | { type: 'api-key'; headerName: string; value: string }

export interface HttpRequestDef {
  id: string
  name: string
  method: HttpMethod
  url: string
  params: KeyValue[]
  headers: KeyValue[]
  cookies: KeyValue[]
  auth: AuthConfig
  body: RequestBody
  timeout: string
  tags: KeyValue[]
  checks: CheckDef[]
  /** Capture values from the response into variables usable downstream */
  extractors: ExtractorDef[]
}

export interface ExtractorDef {
  id: string
  /** Variable name the value is stored under */
  variable: string
  source: 'json' | 'header' | 'status'
  /** JSON path (dot notation) or header name */
  expression: string
}

/* ------------------------------------------------------------------ */
/* Checks                                                              */
/* ------------------------------------------------------------------ */

export type CheckKind = 'status' | 'duration' | 'body-contains' | 'json-path' | 'header'

export type CheckOperator = 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte' | 'contains' | 'exists'

export interface CheckDef {
  id: string
  kind: CheckKind
  /** Human label used as the check name in the generated script */
  label: string
  /** JSON path / header name, depending on kind */
  target: string
  operator: CheckOperator
  value: string
}

/* ------------------------------------------------------------------ */
/* Metrics & thresholds                                                */
/* ------------------------------------------------------------------ */

export type MetricType = 'trend' | 'counter' | 'rate' | 'gauge'

export interface CustomMetricDef {
  id: string
  name: string
  type: MetricType
  /** Trend only: record time values (enables time formatting in output) */
  isTime: boolean
  description: string
}

export type ThresholdAggregation =
  'avg' | 'min' | 'med' | 'max' | 'p(90)' | 'p(95)' | 'p(99)' | 'rate' | 'count' | 'value'

export type ThresholdOperator = '<' | '<=' | '>' | '>=' | '==' | '!='

export interface ThresholdDef {
  id: string
  /** Built-in metric name or custom metric name */
  metric: string
  aggregation: ThresholdAggregation
  operator: ThresholdOperator
  value: string
  abortOnFail: boolean
  delayAbortEval: string
}

/* ------------------------------------------------------------------ */
/* Executors / scenarios                                               */
/* ------------------------------------------------------------------ */

export type ExecutorType =
  | 'shared-iterations'
  | 'per-vu-iterations'
  | 'constant-vus'
  | 'ramping-vus'
  | 'constant-arrival-rate'
  | 'ramping-arrival-rate'
  | 'externally-controlled'

export interface StageDef {
  id: string
  duration: string
  target: number
}

export interface ExecutorConfig {
  type: ExecutorType
  /* shared-iterations / per-vu-iterations */
  vus: number
  iterations: number
  maxDuration: string
  /* constant-vus */
  duration: string
  /* ramping-vus */
  startVUs: number
  stages: StageDef[]
  gracefulRampDown: string
  /* arrival-rate */
  rate: number
  startRate: number
  timeUnit: string
  preAllocatedVUs: number
  maxVUs: number
}

/**
 * Workload template a scenario was created from. The catalogue itself — ramps,
 * gates, educational copy — lives in lib/k6/scenario-types.ts; only the
 * identifier belongs to the model.
 */
export type ScenarioTypeId =
  'smoke' | 'load' | 'stress' | 'spike' | 'capacity' | 'breakpoint' | 'soak' | 'custom'

export interface ScenarioDef {
  id: string
  name: string
  /** The workload template this scenario started from. */
  typeId: ScenarioTypeId
  /** Why this scenario exists — shown in the builder and the generated docs. */
  description: string
  /** Disabled scenarios stay in the suite but are left out of the script. */
  enabled: boolean
  executor: ExecutorConfig
  startTime: string
  gracefulStop: string
  /** Additional tags applied to all metrics of the scenario */
  tags: KeyValue[]
  /** Scenario-scoped environment variables */
  env: KeyValue[]
  /**
   * Quality gates that apply to this scenario alone. Emitted as tag-scoped
   * thresholds (`http_req_duration{scenario:name}`) so a smoke gate can never
   * fail because the stress scenario was slow.
   */
  thresholds: ThresholdDef[]
}

/* ------------------------------------------------------------------ */
/* Flow steps                                                          */
/* ------------------------------------------------------------------ */

export type Step =
  RequestStep | BatchStep | GroupStep | SleepStep | ThinkTimeStep | ConditionalStep | LoopStep

export interface RequestStep {
  kind: 'request'
  id: string
  request: HttpRequestDef
}

export interface BatchStep {
  kind: 'batch'
  id: string
  name: string
  /** Requests issued in parallel via http.batch() */
  requests: HttpRequestDef[]
}

export interface GroupStep {
  kind: 'group'
  id: string
  name: string
  children: Step[]
}

export interface SleepStep {
  kind: 'sleep'
  id: string
  seconds: number
}

export interface ThinkTimeStep {
  kind: 'think-time'
  id: string
  minSeconds: number
  maxSeconds: number
}

export interface ConditionalStep {
  kind: 'conditional'
  id: string
  /** JS expression evaluated at runtime, e.g. `res.status === 200` */
  condition: string
  whenTrue: Step[]
  whenFalse: Step[]
}

export interface LoopStep {
  kind: 'loop'
  id: string
  iterations: number
  children: Step[]
}

/* ------------------------------------------------------------------ */
/* Runtime                                                             */
/* ------------------------------------------------------------------ */

export interface EnvVarDef {
  id: string
  name: string
  defaultValue: string
  required: boolean
  description: string
}

export interface SharedDataDef {
  id: string
  /** Identifier of the SharedArray in the script */
  name: string
  /** Inline JSON array embedded in the script */
  json: string
}

export interface GlobalOptions {
  userAgent: string
  maxRedirects: number
  insecureSkipTLSVerify: boolean
  discardResponseBodies: boolean
  noConnectionReuse: boolean
  throw: boolean
  dns: {
    ttl: string
    select: 'first' | 'random' | 'roundRobin'
    policy: 'preferIPv4' | 'preferIPv6' | 'onlyIPv4' | 'onlyIPv6' | 'any'
  }
  summaryTrendStats: string[]
  tags: KeyValue[]
  setupTimeout: string
  teardownTimeout: string
}

/* ------------------------------------------------------------------ */
/* Test plan (root)                                                    */
/* ------------------------------------------------------------------ */

/**
 * How the scenarios of one suite relate to each other.
 *
 * `one-at-a-time` — the scenarios are alternative workloads over the same
 * journey (smoke *or* load *or* soak). The script runs one per invocation,
 * selected with `-e SCENARIO=<name>`, because starting a four-hour soak
 * concurrently with a smoke test measures neither.
 *
 * `all-together` — the scenarios are parts of one mixed workload (browsing plus
 * checkout plus a background writer) and run in the same test, sequenced by
 * their `startTime`.
 */
export type ScenarioExecutionMode = 'one-at-a-time' | 'all-together'

export interface TestPlan {
  meta: {
    name: string
    description: string
    baseUrl: string
  }
  options: GlobalOptions
  /** Whether the scenarios below are alternatives or one combined workload. */
  execution: ScenarioExecutionMode
  scenarios: ScenarioPlan[]
  /** Gates that apply to the whole suite, whichever scenario runs. */
  thresholds: ThresholdDef[]
  customMetrics: CustomMetricDef[]
  envVars: EnvVarDef[]
  sharedData: SharedDataDef[]
  hasSetup: boolean
  setupSteps: Step[]
  hasTeardown: boolean
  teardownSteps: Step[]
}

export interface ScenarioPlan {
  scenario: ScenarioDef
  steps: Step[]
}
