import { generateScript, toIdentifier } from '@/lib/codegen/generate'
import { activeScenarioPlans, scopedThresholds } from '@/lib/dsl/plan'
import type {
  CheckDef,
  CustomMetricDef,
  ExecutorConfig,
  HttpRequestDef,
  Step,
  TestPlan,
  ThresholdDef
} from '@/lib/dsl/types'
import { AGGREGATIONS_BY_TYPE, BUILTIN_METRICS, builtinMetric } from '@/lib/k6/metrics'
import { maybeScenarioType } from '@/lib/k6/scenario-types'
import { isValidDuration, tryParseJson, uid } from '@/lib/utils'

export type IssueSeverity = 'error' | 'warning'

export interface ValidationIssue {
  id: string
  severity: IssueSeverity
  /** Id of the DSL entity (and canvas node) the issue belongs to, '' for plan-level issues */
  refId: string
  /** Where the issue lives, for grouping in the UI */
  area: 'project' | 'scenario' | 'request' | 'flow' | 'threshold' | 'metric' | 'runtime' | 'script'
  message: string
  fix: string
}

export interface ValidationResult {
  issues: ValidationIssue[]
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
  valid: boolean
}

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
const METRIC_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/
const PLACEHOLDER_RE = /\{\{\s*([A-Za-z_$][A-Za-z0-9_$]*)(\.[A-Za-z0-9_$]+)*\s*\}\}/g

class Collector {
  issues: ValidationIssue[] = []

  error(refId: string, area: ValidationIssue['area'], message: string, fix: string): void {
    this.issues.push({ id: uid(), severity: 'error', refId, area, message, fix })
  }

  warning(refId: string, area: ValidationIssue['area'], message: string, fix: string): void {
    this.issues.push({ id: uid(), severity: 'warning', refId, area, message, fix })
  }
}

/* ------------------------------------------------------------------ */
/* Executors                                                           */
/* ------------------------------------------------------------------ */

function validateExecutor(refId: string, name: string, config: ExecutorConfig, out: Collector): void {
  const label = `Scenario "${name}"`

  const requireDuration = (value: string, field: string): void => {
    if (!isValidDuration(value)) {
      out.error(
        refId,
        'scenario',
        `${label}: ${field} "${value}" is not a valid duration`,
        'Use k6 duration syntax such as 30s, 5m or 1h30m.'
      )
    }
  }
  const requirePositive = (value: number, field: string): void => {
    if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
      out.error(
        refId,
        'scenario',
        `${label}: ${field} must be a positive integer (got ${value})`,
        `Set ${field} to a whole number greater than zero.`
      )
    }
  }
  const validateStages = (): void => {
    if (config.stages.length === 0) {
      out.error(
        refId,
        'scenario',
        `${label}: the ${config.type} executor requires at least one stage`,
        'Add a stage with a duration and a target.'
      )
      return
    }
    config.stages.forEach((stage, indexNum) => {
      if (!isValidDuration(stage.duration)) {
        out.error(
          refId,
          'scenario',
          `${label}: stage ${indexNum + 1} duration "${stage.duration}" is invalid`,
          'Use k6 duration syntax such as 30s or 5m.'
        )
      }
      if (!Number.isFinite(stage.target) || stage.target < 0 || !Number.isInteger(stage.target)) {
        out.error(
          refId,
          'scenario',
          `${label}: stage ${indexNum + 1} target must be a non-negative integer`,
          'Set the stage target to 0 or a positive whole number.'
        )
      }
    })
  }

  switch (config.type) {
    case 'shared-iterations':
    case 'per-vu-iterations':
      requirePositive(config.vus, 'vus')
      requirePositive(config.iterations, 'iterations')
      requireDuration(config.maxDuration, 'maxDuration')
      if (config.type === 'shared-iterations' && config.iterations < config.vus) {
        out.warning(
          refId,
          'scenario',
          `${label}: fewer total iterations (${config.iterations}) than VUs (${config.vus}) — some VUs will never run`,
          'Increase iterations or reduce VUs.'
        )
      }
      break
    case 'constant-vus':
      requirePositive(config.vus, 'vus')
      requireDuration(config.duration, 'duration')
      break
    case 'ramping-vus':
      if (config.startVUs < 0 || !Number.isInteger(config.startVUs)) {
        out.error(
          refId,
          'scenario',
          `${label}: startVUs must be a non-negative integer`,
          'Set startVUs to 0 or higher.'
        )
      }
      validateStages()
      requireDuration(config.gracefulRampDown, 'gracefulRampDown')
      if (config.stages.length > 0 && config.stages[config.stages.length - 1].target !== 0) {
        out.warning(
          refId,
          'scenario',
          `${label}: the last stage does not ramp down to 0 VUs`,
          'End with a { duration, target: 0 } stage to observe system recovery.'
        )
      }
      break
    case 'constant-arrival-rate':
      requirePositive(config.rate, 'rate')
      requireDuration(config.timeUnit, 'timeUnit')
      requireDuration(config.duration, 'duration')
      requirePositive(config.preAllocatedVUs, 'preAllocatedVUs')
      if (config.maxVUs > 0 && config.maxVUs < config.preAllocatedVUs) {
        out.error(
          refId,
          'scenario',
          `${label}: maxVUs (${config.maxVUs}) is lower than preAllocatedVUs (${config.preAllocatedVUs})`,
          'Set maxVUs greater than or equal to preAllocatedVUs, or leave it at 0 to omit it.'
        )
      }
      break
    case 'ramping-arrival-rate':
      if (config.startRate < 0 || !Number.isInteger(config.startRate)) {
        out.error(
          refId,
          'scenario',
          `${label}: startRate must be a non-negative integer`,
          'Set startRate to 0 or higher.'
        )
      }
      requireDuration(config.timeUnit, 'timeUnit')
      validateStages()
      requirePositive(config.preAllocatedVUs, 'preAllocatedVUs')
      if (config.maxVUs > 0 && config.maxVUs < config.preAllocatedVUs) {
        out.error(
          refId,
          'scenario',
          `${label}: maxVUs (${config.maxVUs}) is lower than preAllocatedVUs (${config.preAllocatedVUs})`,
          'Set maxVUs greater than or equal to preAllocatedVUs, or leave it at 0 to omit it.'
        )
      }
      break
    case 'externally-controlled':
      requirePositive(config.maxVUs, 'maxVUs')
      requireDuration(config.duration, 'duration')
      if (config.vus > config.maxVUs) {
        out.error(
          refId,
          'scenario',
          `${label}: initial vus (${config.vus}) exceed maxVUs (${config.maxVUs})`,
          'Lower vus or raise maxVUs.'
        )
      }
      break
  }
}

/* ------------------------------------------------------------------ */
/* Requests & steps                                                    */
/* ------------------------------------------------------------------ */

function validateCheck(refId: string, requestName: string, checkDef: CheckDef, out: Collector): void {
  const label = `Check "${checkDef.label}" on "${requestName}"`
  if (checkDef.label.trim() === '') {
    out.error(
      refId,
      'request',
      `A check on "${requestName}" has no label`,
      'Give every check a descriptive name — it becomes the check name in k6 results.'
    )
  }
  if (checkDef.kind === 'status' || checkDef.kind === 'duration') {
    if (!/^-?\d+(\.\d+)?$/.test(checkDef.value.trim())) {
      out.error(
        refId,
        'request',
        `${label}: value "${checkDef.value}" must be a number`,
        checkDef.kind === 'status'
          ? 'Use a numeric HTTP status such as 200.'
          : 'Use a numeric duration in milliseconds such as 500.'
      )
    }
  }
  if ((checkDef.kind === 'json-path' || checkDef.kind === 'header') && checkDef.target.trim() === '') {
    out.error(
      refId,
      'request',
      `${label}: no ${checkDef.kind === 'json-path' ? 'JSON path' : 'header name'} configured`,
      checkDef.kind === 'json-path'
        ? 'Set the JSON path to assert, e.g. data.token.'
        : 'Set the header name, e.g. Content-Type.'
    )
  }
  if (checkDef.kind === 'body-contains' && checkDef.value.trim() === '') {
    out.error(
      refId,
      'request',
      `${label}: no text to search for in the body`,
      'Provide the substring the response body must contain.'
    )
  }
}

function validateRequest(
  refId: string,
  request: HttpRequestDef,
  baseUrl: string,
  knownVars: Set<string>,
  out: Collector
): void {
  const name = request.name.trim() === '' ? 'Unnamed request' : request.name

  if (request.name.trim() === '') {
    out.error(
      refId,
      'request',
      'A request has no name',
      'Name every request — the name is used for metric tags and batch keys.'
    )
  }

  const urlNoPlaceholders = request.url.replace(PLACEHOLDER_RE, 'x')
  if (request.url.trim() === '') {
    out.error(refId, 'request', `Request "${name}" has no URL`, 'Set the target URL in the properties panel.')
  } else if (
    !/^https?:\/\//i.test(urlNoPlaceholders) &&
    !(baseUrl !== '' && request.url.startsWith(baseUrl))
  ) {
    out.error(
      refId,
      'request',
      `Request "${name}" URL "${request.url}" must start with http:// or https://`,
      'Use an absolute URL, or set a global Base URL and keep the URL relative to it.'
    )
  }

  if (request.body.mode === 'json' && request.body.raw.trim() !== '') {
    const withoutPlaceholders = request.body.raw.replace(PLACEHOLDER_RE, '"x"')
    const parsed = tryParseJson(request.body.raw)
    const parsedSubstituted = tryParseJson(withoutPlaceholders)
    if (!parsed.ok && !parsedSubstituted.ok) {
      out.error(
        refId,
        'request',
        `Request "${name}" JSON body is invalid: ${parsed.error ?? ''}`,
        'Fix the JSON syntax or switch the body mode to raw text.'
      )
    }
  }

  if (request.timeout.trim() !== '' && !isValidDuration(request.timeout)) {
    out.error(
      refId,
      'request',
      `Request "${name}" timeout "${request.timeout}" is not a valid duration`,
      'Use k6 duration syntax such as 30s or 2m.'
    )
  }

  for (const checkDef of request.checks) validateCheck(refId, name, checkDef, out)

  for (const extractor of request.extractors) {
    if (!IDENTIFIER_RE.test(extractor.variable)) {
      out.error(
        refId,
        'request',
        `Request "${name}": extractor variable "${extractor.variable}" is not a valid JavaScript identifier`,
        'Use letters, digits, _ or $ and do not start with a digit, e.g. authToken.'
      )
    } else {
      knownVars.add(extractor.variable)
    }
    if (extractor.source !== 'status' && extractor.expression.trim() === '') {
      out.error(
        refId,
        'request',
        `Request "${name}": extractor "${extractor.variable}" has no ${extractor.source === 'json' ? 'JSON path' : 'header name'}`,
        'Set the expression the value should be read from.'
      )
    }
  }

  /* Unknown placeholder references */
  const scan = [
    request.url,
    request.body.raw,
    ...request.headers.map((h) => h.value),
    ...request.params.map((p) => p.value)
  ]
  for (const text of scan) {
    for (const match of text.matchAll(PLACEHOLDER_RE)) {
      const varName = match[1]
      if (!knownVars.has(varName)) {
        out.warning(
          refId,
          'request',
          `Request "${name}" references {{${varName}}}, which is not a known variable`,
          'Define it as an environment variable, or extract it from a previous response.'
        )
      }
    }
  }
}

/**
 * Validates a chain of steps, counting the HTTP requests it contains.
 *
 * `seen` carries the step ids already validated. Scenarios normally share one
 * journey — the whole point of a multi-scenario suite — so without it the same
 * request node would be reported once per scenario referencing it.
 */
function validateSteps(
  steps: Step[],
  baseUrl: string,
  knownVars: Set<string>,
  out: Collector,
  seen: Set<string>
): number {
  let requestCount = 0
  for (const step of steps) {
    if (seen.has(step.id)) continue
    seen.add(step.id)
    switch (step.kind) {
      case 'request':
        requestCount += 1
        validateRequest(step.id, step.request, baseUrl, knownVars, out)
        break
      case 'batch':
        if (step.requests.length === 0) {
          out.error(
            step.id,
            'flow',
            `Batch "${step.name}" contains no requests`,
            'Add at least one request to the parallel batch, or remove the node.'
          )
        }
        requestCount += step.requests.length
        for (const request of step.requests) validateRequest(step.id, request, baseUrl, knownVars, out)
        break
      case 'group':
        if (step.name.trim() === '') {
          out.error(
            step.id,
            'flow',
            'A group has no name',
            'Group names become metric tags — name it after the business step, e.g. Checkout.'
          )
        }
        if (step.children.length === 0) {
          out.warning(
            step.id,
            'flow',
            `Group "${step.name}" is empty`,
            'Drag steps inside the group node, or remove it.'
          )
        }
        requestCount += validateSteps(step.children, baseUrl, knownVars, out, seen)
        break
      case 'sleep':
        if (!Number.isFinite(step.seconds) || step.seconds <= 0) {
          out.error(
            step.id,
            'flow',
            `Sleep duration must be greater than 0 (got ${step.seconds})`,
            'Set the sleep duration in seconds, e.g. 1.'
          )
        }
        break
      case 'think-time':
        if (step.minSeconds < 0 || step.maxSeconds <= 0 || step.minSeconds >= step.maxSeconds) {
          out.error(
            step.id,
            'flow',
            `Think time range ${step.minSeconds}–${step.maxSeconds}s is invalid`,
            'Use a positive range where min is smaller than max, e.g. 1–4s.'
          )
        }
        break
      case 'conditional':
        if (step.condition.trim() === '') {
          out.error(
            step.id,
            'flow',
            'Conditional branch has no condition expression',
            'Provide a JavaScript expression, e.g. res.status === 200.'
          )
        }
        if (step.whenTrue.length === 0 && step.whenFalse.length === 0) {
          out.warning(
            step.id,
            'flow',
            'Conditional branch has no steps on either branch',
            'Connect steps to the true or false handle, or remove the node.'
          )
        }
        requestCount += validateSteps(step.whenTrue, baseUrl, knownVars, out, seen)
        requestCount += validateSteps(step.whenFalse, baseUrl, knownVars, out, seen)
        break
      case 'loop':
        if (!Number.isInteger(step.iterations) || step.iterations <= 0) {
          out.error(
            step.id,
            'flow',
            `Loop iterations must be a positive integer (got ${step.iterations})`,
            'Set the number of repetitions, e.g. 3.'
          )
        }
        if (step.children.length === 0) {
          out.warning(
            step.id,
            'flow',
            'Loop has no steps in its body',
            'Connect steps to the loop body handle, or remove the node.'
          )
        }
        requestCount += validateSteps(step.children, baseUrl, knownVars, out, seen)
        break
    }
  }
  return requestCount
}

/* ------------------------------------------------------------------ */
/* Thresholds & metrics                                                */
/* ------------------------------------------------------------------ */

/**
 * Validates one gate. `refId` is what the UI selects when the issue is clicked:
 * the threshold node for suite-wide gates, the owning scenario for scoped ones.
 */
function validateThreshold(
  threshold: ThresholdDef,
  customMetrics: CustomMetricDef[],
  out: Collector,
  scope: { refId: string; label: string } = { refId: threshold.id, label: 'A threshold' }
): void {
  const refId = scope.refId
  if (threshold.metric.trim() === '') {
    out.error(
      refId,
      'threshold',
      `${scope.label} has no metric selected`,
      'Choose the metric this threshold applies to, e.g. http_req_duration.'
    )
    return
  }

  const builtin = builtinMetric(threshold.metric)
  const custom = customMetrics.find((m) => m.name === threshold.metric)
  const type = builtin?.type ?? custom?.type

  if (type === undefined) {
    out.error(
      refId,
      'threshold',
      `${scope.label} references unknown metric "${threshold.metric}"`,
      `Use one of the built-in metrics (${BUILTIN_METRICS.slice(0, 3)
        .map((m) => m.name)
        .join(', ')}, …) or define a custom metric with this name.`
    )
    return
  }

  if (!AGGREGATIONS_BY_TYPE[type].includes(threshold.aggregation)) {
    out.error(
      refId,
      'threshold',
      `Aggregation "${threshold.aggregation}" is not valid for ${type} metric "${threshold.metric}"`,
      `Valid aggregations for a ${type} metric: ${AGGREGATIONS_BY_TYPE[type].join(', ')}.`
    )
  }

  if (!/^-?\d+(\.\d+)?$/.test(threshold.value.trim())) {
    out.error(
      refId,
      'threshold',
      `Threshold value "${threshold.value}" on "${threshold.metric}" must be numeric`,
      'Use a plain number — milliseconds for durations, 0–1 for rates.'
    )
  } else if (type === 'rate' && Number(threshold.value) > 1) {
    out.warning(
      refId,
      'threshold',
      `Threshold on rate metric "${threshold.metric}" compares against ${threshold.value} — rates are between 0 and 1`,
      'Use a fraction, e.g. 0.01 for 1%.'
    )
  }

  if (
    threshold.abortOnFail &&
    threshold.delayAbortEval.trim() !== '' &&
    !isValidDuration(threshold.delayAbortEval)
  ) {
    out.error(
      refId,
      'threshold',
      `delayAbortEval "${threshold.delayAbortEval}" is not a valid duration`,
      'Use k6 duration syntax such as 10s, or leave it empty.'
    )
  }
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export function validatePlan(plan: TestPlan): ValidationResult {
  const out = new Collector()

  /* Project */
  if (plan.meta.name.trim() === '') {
    out.error('', 'project', 'The project has no name', 'Set a project name in Step 1.')
  }
  if (plan.meta.baseUrl.trim() !== '' && !/^https?:\/\//i.test(plan.meta.baseUrl.trim())) {
    out.error(
      '',
      'project',
      `Base URL "${plan.meta.baseUrl}" must start with http:// or https://`,
      'Use an absolute base URL, e.g. https://api.example.com.'
    )
  }

  /* Scenarios */
  if (plan.scenarios.length === 0) {
    out.error(
      '',
      'scenario',
      'The suite has no scenarios',
      'Add a scenario in the Scenarios panel — every k6 test needs at least one workload.'
    )
  } else if (plan.scenarios.every((entry) => !entry.scenario.enabled)) {
    out.error(
      '',
      'scenario',
      'Every scenario in this suite is disabled — the exported script would run nothing',
      'Enable at least one scenario with the toggle on its card.'
    )
  }

  const active = activeScenarioPlans(plan)
  const activeIds = new Set(active.map((entry) => entry.scenario.id))
  const scenarioNames = new Set<string>()
  const scenarioIdents = new Set<string>()
  for (const { scenario } of plan.scenarios) {
    if (scenario.name.trim() === '') {
      out.error(
        scenario.id,
        'scenario',
        'A scenario has no name',
        'Name the scenario — it identifies the workload in results.'
      )
    }
    if (scenarioNames.has(scenario.name)) {
      out.error(
        scenario.id,
        'scenario',
        `Duplicate scenario name "${scenario.name}"`,
        'Scenario names must be unique within a test.'
      )
    }
    scenarioNames.add(scenario.name)
    const ident = toIdentifier(scenario.name, 'scenario')
    if (scenarioIdents.has(ident)) {
      out.error(
        scenario.id,
        'scenario',
        `Scenario name "${scenario.name}" collides with another scenario after conversion to identifier "${ident}"`,
        'Rename one of the scenarios so their generated function names differ.'
      )
    }
    scenarioIdents.add(ident)
    if (
      !isValidDuration(scenario.startTime) &&
      scenario.startTime.trim() !== '' &&
      scenario.startTime !== '0s'
    ) {
      out.error(
        scenario.id,
        'scenario',
        `Scenario "${scenario.name}" startTime "${scenario.startTime}" is not a valid duration`,
        'Use k6 duration syntax such as 0s or 2m.'
      )
    }
    if (scenario.gracefulStop.trim() !== '' && !isValidDuration(scenario.gracefulStop)) {
      out.error(
        scenario.id,
        'scenario',
        `Scenario "${scenario.name}" gracefulStop "${scenario.gracefulStop}" is not a valid duration`,
        'Use k6 duration syntax such as 30s.'
      )
    }
    validateExecutor(scenario.id, scenario.name, scenario.executor, out)

    /* Gates scoped to this scenario. They report on the scenario itself, since
       that is where they are edited. */
    for (const threshold of scenario.thresholds) {
      validateThreshold(threshold, plan.customMetrics, out, {
        refId: scenario.id,
        label: `Scenario "${scenario.name}": the gate on "${threshold.metric}"`
      })
    }
    if (scenario.thresholds.length === 0 && plan.thresholds.length === 0 && activeIds.has(scenario.id)) {
      out.warning(
        scenario.id,
        'threshold',
        `Scenario "${scenario.name}" has no quality gates — it can never fail automatically`,
        'Add a threshold (e.g. http_req_duration p(95)<500) so k6 exits non-zero when the SLO is missed.'
      )
    }
  }

  /* Scenarios that run concurrently must be meant to. */
  if (plan.execution === 'all-together' && active.length > 1) {
    for (const { scenario } of active) {
      if (maybeScenarioType(scenario.typeId)?.longRunning !== true) continue
      out.warning(
        scenario.id,
        'scenario',
        `"${scenario.name}" runs for hours, and this suite runs every scenario in the same test`,
        'Switch the suite to “one at a time”, or give this scenario a startTime so it does not overlap the others.'
      )
    }
  }

  /* Environment variables (validate before steps so placeholders resolve) */
  const knownVars = new Set<string>(['__ENV', '__VU', '__ITER'])
  if (plan.meta.baseUrl.trim() !== '') knownVars.add('BASE_URL')
  const envNames = new Set<string>()
  for (const envVar of plan.envVars) {
    if (envVar.name.trim() === '') {
      out.error(
        envVar.id,
        'runtime',
        'An environment variable has no name',
        'Name the variable, e.g. API_TOKEN, or remove it.'
      )
      continue
    }
    if (!ENV_NAME_RE.test(envVar.name)) {
      out.error(
        envVar.id,
        'runtime',
        `Environment variable name "${envVar.name}" is invalid`,
        'Use letters, digits and underscores, starting with a letter — e.g. BASE_URL.'
      )
    }
    if (envNames.has(envVar.name)) {
      out.error(
        envVar.id,
        'runtime',
        `Duplicate environment variable "${envVar.name}"`,
        'Environment variable names must be unique.'
      )
    }
    envNames.add(envVar.name)
    knownVars.add(envVar.name)
    if (envVar.required && envVar.defaultValue.trim() === '') {
      out.warning(
        envVar.id,
        'runtime',
        `Required variable "${envVar.name}" has no default — the script will throw unless -e ${envVar.name}=… is passed`,
        'This is often intended for secrets; add a default if it is not.'
      )
    }
  }

  /* Custom metrics */
  const metricNames = new Set<string>()
  for (const metric of plan.customMetrics) {
    if (metric.name.trim() === '') {
      out.error(
        metric.id,
        'metric',
        'A custom metric has no name',
        'Name the metric, e.g. checkout_duration, or remove it.'
      )
      continue
    }
    if (!METRIC_NAME_RE.test(metric.name)) {
      out.error(
        metric.id,
        'metric',
        `Custom metric name "${metric.name}" is invalid`,
        'Use letters, digits and underscores, up to 128 characters, starting with a letter.'
      )
    }
    if (builtinMetric(metric.name) !== undefined) {
      out.error(
        metric.id,
        'metric',
        `Custom metric "${metric.name}" clashes with a built-in k6 metric`,
        'Choose a different name — built-in metrics cannot be redefined.'
      )
    }
    if (metricNames.has(metric.name)) {
      out.error(
        metric.id,
        'metric',
        `Duplicate custom metric "${metric.name}"`,
        'Metric names must be unique.'
      )
    }
    metricNames.add(metric.name)
  }

  /* Shared data */
  const sharedNames = new Set<string>()
  for (const data of plan.sharedData) {
    if (!IDENTIFIER_RE.test(data.name)) {
      out.error(
        data.id,
        'runtime',
        `Shared data name "${data.name}" is not a valid identifier`,
        'Use a valid JavaScript identifier, e.g. users.'
      )
    }
    if (sharedNames.has(data.name)) {
      out.error(
        data.id,
        'runtime',
        `Duplicate shared data name "${data.name}"`,
        'Shared data identifiers must be unique.'
      )
    }
    sharedNames.add(data.name)
    const parsed = tryParseJson(data.json)
    if (!parsed.ok) {
      out.error(
        data.id,
        'runtime',
        `Shared data "${data.name}" contains invalid JSON: ${parsed.error ?? ''}`,
        'Fix the JSON — it must be an array of objects.'
      )
    } else {
      try {
        if (!Array.isArray(JSON.parse(data.json))) {
          out.error(
            data.id,
            'runtime',
            `Shared data "${data.name}" must be a JSON array`,
            'Wrap the data in [ … ] — SharedArray only accepts arrays.'
          )
        }
      } catch {
        /* already reported */
      }
    }
    knownVars.add(data.name)
  }

  /* Cross-category {{placeholder}} name collisions: env var / metric / shared
     data sharing a logical name makes {{name}} references ambiguous. */
  const logicalOwners = new Map<string, string>()
  const noteLogical = (name: string, category: string, refId: string): void => {
    if (name.trim() === '') return
    const existing = logicalOwners.get(name)
    if (existing !== undefined && existing !== category) {
      out.warning(
        refId,
        'runtime',
        `"${name}" is used by both a ${existing} and a ${category} — {{${name}}} references are ambiguous`,
        'Rename one of them so every referenced name is unique.'
      )
    } else {
      logicalOwners.set(name, category)
    }
  }
  for (const envVar of plan.envVars) noteLogical(envVar.name, 'environment variable', envVar.id)
  for (const metric of plan.customMetrics) noteLogical(metric.name, 'custom metric', metric.id)
  for (const data of plan.sharedData) noteLogical(data.name, 'shared data', data.id)

  /* Steps. Shared journeys are validated once, not once per scenario. */
  const baseUrl = plan.meta.baseUrl.trim().replace(/\/$/, '')
  const seenSteps = new Set<string>()
  let totalRequests = 0
  for (const scenarioPlan of plan.scenarios) {
    totalRequests += validateSteps(scenarioPlan.steps, baseUrl, knownVars, out, seenSteps)
    if (scenarioPlan.steps.length === 0) {
      const disabled = !scenarioPlan.scenario.enabled
      const message = `Scenario "${scenarioPlan.scenario.name}" has no steps connected`
      const fix = 'Connect the scenario node to the first step of a journey on the canvas.'
      if (disabled) out.warning(scenarioPlan.scenario.id, 'flow', message, fix)
      else out.error(scenarioPlan.scenario.id, 'flow', message, fix)
    }
  }
  if (plan.hasSetup) totalRequests += validateSteps(plan.setupSteps, baseUrl, knownVars, out, seenSteps)
  if (plan.hasTeardown) totalRequests += validateSteps(plan.teardownSteps, baseUrl, knownVars, out, seenSteps)

  if (totalRequests === 0 && plan.scenarios.length > 0) {
    out.error(
      '',
      'flow',
      'The suite contains no HTTP requests',
      'Drag a request from the sidebar onto the canvas and connect it to a scenario.'
    )
  }

  /* Suite-wide thresholds */
  for (const threshold of plan.thresholds) validateThreshold(threshold, plan.customMetrics, out)
  const allThresholds = scopedThresholds(plan).map((entry) => entry.threshold)
  if (allThresholds.length === 0 && plan.scenarios.length > 0) {
    out.warning(
      '',
      'threshold',
      'No thresholds configured — the suite can never fail automatically',
      'Add thresholds (e.g. http_req_duration p(95)<500) so k6 exits non-zero on SLO violations.'
    )
  }
  const hasChecks = active.some((s) => planHasChecks(s.steps))
  if (hasChecks && !allThresholds.some((t) => t.metric === 'checks')) {
    out.warning(
      '',
      'threshold',
      'The suite has checks but no threshold on the checks metric — failing checks will not fail the run',
      'Add a threshold like checks: rate>0.99.'
    )
  }

  /* Generated script syntax smoke test */
  const hasErrors = out.issues.some((issue) => issue.severity === 'error')
  if (!hasErrors && plan.scenarios.length > 0) {
    try {
      const script = generateScript(plan)
      const stripped = script
        .replace(/^import .*$/gm, '')
        .replace(/^export default function/gm, 'const __defaultFn = function')
        .replace(/^export /gm, '')
      new Function(
        'http',
        'check',
        'group',
        'sleep',
        '__ENV',
        'open',
        'SharedArray',
        'Trend',
        'Counter',
        'Rate',
        'Gauge',
        'b64encode',
        stripped
      )
    } catch (error) {
      out.error(
        '',
        'script',
        `The generated script has a JavaScript syntax error: ${error instanceof Error ? error.message : 'unknown'}`,
        'This usually comes from a custom condition expression — check conditional branch nodes for invalid JavaScript.'
      )
    }
  }

  const errors = out.issues.filter((issue) => issue.severity === 'error')
  const warnings = out.issues.filter((issue) => issue.severity === 'warning')
  return { issues: out.issues, errors, warnings, valid: errors.length === 0 }
}

function planHasChecks(steps: Step[]): boolean {
  return steps.some((step) => {
    switch (step.kind) {
      case 'request':
        return step.request.checks.length > 0
      case 'batch':
        return step.requests.some((r) => r.checks.length > 0)
      case 'group':
        return planHasChecks(step.children)
      case 'conditional':
        return planHasChecks(step.whenTrue) || planHasChecks(step.whenFalse)
      case 'loop':
        return planHasChecks(step.children)
      default:
        return false
    }
  })
}
