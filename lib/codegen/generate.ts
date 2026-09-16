import { activeScenarioPlans } from '@/lib/dsl/plan'
import type {
  CheckDef,
  ExecutorConfig,
  GlobalOptions,
  HttpRequestDef,
  KeyValue,
  ScenarioDef,
  Step,
  TestPlan,
  ThresholdDef
} from '@/lib/dsl/types'
import {
  arr,
  arrow,
  binary,
  blank,
  bool,
  call,
  comment,
  constStmt,
  exprStmt,
  forCount,
  func,
  id,
  ifStmt,
  importStmt,
  index,
  member,
  num,
  obj,
  prop,
  propComputed,
  raw,
  returnStmt,
  str,
  tExpr,
  tText,
  template,
  type Expr,
  type ObjectProp,
  type Program,
  type Stmt,
  type TemplatePart
} from './js-ast'
import { printProgram } from './print'

/* ------------------------------------------------------------------ */
/* Generation context                                                  */
/* ------------------------------------------------------------------ */

interface GenContext {
  plan: TestPlan
  needs: {
    check: boolean
    group: boolean
    sleep: boolean
    b64encode: boolean
    sharedArray: boolean
  }
  metricConsts: Map<string, string>
  fileConsts: Map<string, string>
  baseUrlConst: string | null
  /** All module-scope identifier names, so per-function locals never collide. */
  moduleNames: NameAllocator
  /** Logical name → emitted module identifier (env vars, metrics, shared data). */
  nameMap: Map<string, string>
}

/**
 * Resolves a {{placeholder}} path to the emitted identifier. Env vars, custom
 * metrics and shared data are declared under sanitized/unique identifiers that
 * may differ from their logical name, so `{{Users}}` must map to `const users`.
 * The map is swapped per generated function so request extractors resolve too.
 */
let currentNameMap = new Map<string, string>()

function resolvePlaceholder(expr: string): string {
  const dot = expr.indexOf('.')
  const head = dot === -1 ? expr : expr.slice(0, dot)
  const mapped = currentNameMap.get(head)
  if (mapped === undefined) return expr
  return dot === -1 ? mapped : mapped + expr.slice(dot)
}

class NameAllocator {
  private used = new Set<string>()

  constructor(reserved: string[] = []) {
    for (const name of reserved) this.used.add(name)
  }

  alloc(base: string): string {
    if (!this.used.has(base)) {
      this.used.add(base)
      return base
    }
    let i = 1
    while (this.used.has(`${base}${i}`)) i += 1
    const name = `${base}${i}`
    this.used.add(name)
    return name
  }

  list(): string[] {
    return [...this.used]
  }
}

const RESERVED = new Set([
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'export',
  'extends',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'new',
  'return',
  'super',
  'switch',
  'this',
  'throw',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
  'let',
  'static',
  'options',
  'http'
])

export function toIdentifier(input: string, fallback: string): string {
  const cleaned = input
    .trim()
    .replace(/[^A-Za-z0-9]+(.)/g, (_, ch: string) => ch.toUpperCase())
    .replace(/[^A-Za-z0-9_$]/g, '')
  const name = /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned
  if (name === '' || RESERVED.has(name)) return fallback
  return name.charAt(0).toLowerCase() + name.slice(1)
}

/**
 * The key a scenario is emitted under in `options.scenarios` — which is also its
 * `scenario` metric tag and the value passed to `-e SCENARIO=`. k6 accepts
 * letters, digits, underscores and dashes here, so the identifier form is safe.
 */
export function scenarioKey(name: string): string {
  return toIdentifier(name, 'scenario')
}

const VALID_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/**
 * Keeps names that are already valid, non-reserved identifiers verbatim
 * (e.g. API_TOKEN, users, journey_time, authToken) so declarations stay
 * readable and {{placeholders}} round-trip; only sanitizes when necessary.
 */
export function preferredIdentifier(name: string, fallback: string): string {
  const trimmed = name.trim()
  if (VALID_IDENTIFIER.test(trimmed) && !RESERVED.has(trimmed)) return trimmed
  return toIdentifier(trimmed, fallback)
}

/* ------------------------------------------------------------------ */
/* String interpolation: "{{var}}" placeholders → template literals     */
/* ------------------------------------------------------------------ */

const PLACEHOLDER_RE = /\{\{\s*([A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z0-9_$]+)*)\s*\}\}/g

function interpolateParts(value: string): TemplatePart[] {
  const parts: TemplatePart[] = []
  let last = 0
  for (const match of value.matchAll(PLACEHOLDER_RE)) {
    const start = match.index ?? 0
    if (start > last) parts.push(tText(value.slice(last, start)))
    parts.push(tExpr(raw(resolvePlaceholder(match[1]))))
    last = start + match[0].length
  }
  if (last < value.length) parts.push(tText(value.slice(last)))
  return parts
}

function interpolate(value: string): Expr {
  const parts = interpolateParts(value)
  const isPlain = parts.every((p) => p.kind === 'text')
  if (isPlain) return str(value)
  return template(parts)
}

/** Does this string contain {{placeholders}}? */
function hasPlaceholders(value: string): boolean {
  PLACEHOLDER_RE.lastIndex = 0
  return PLACEHOLDER_RE.test(value)
}

/* ------------------------------------------------------------------ */
/* JSON → AST                                                          */
/* ------------------------------------------------------------------ */

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

function jsonToExpr(value: JsonValue): Expr {
  if (value === null) return { kind: 'null' }
  if (typeof value === 'string') return interpolate(value)
  if (typeof value === 'number') return num(value)
  if (typeof value === 'boolean') return bool(value)
  if (Array.isArray(value)) return arr(value.map(jsonToExpr))
  return obj(Object.entries(value).map(([key, entry]) => prop(key, jsonToExpr(entry))))
}

/* ------------------------------------------------------------------ */
/* Requests                                                            */
/* ------------------------------------------------------------------ */

const METHOD_FN: Record<string, string> = {
  GET: 'get',
  POST: 'post',
  PUT: 'put',
  PATCH: 'patch',
  DELETE: 'del',
  HEAD: 'head',
  OPTIONS: 'options'
}

function enabled(items: KeyValue[]): KeyValue[] {
  return items.filter((item) => item.enabled && item.key.trim() !== '')
}

function buildUrlExpr(request: HttpRequestDef, ctx: GenContext): Expr {
  let urlString = request.url
  const baseUrl = ctx.plan.meta.baseUrl.trim().replace(/\/$/, '')
  let usesBase = false
  if (ctx.baseUrlConst !== null && baseUrl !== '' && urlString.startsWith(baseUrl)) {
    urlString = urlString.slice(baseUrl.length)
    usesBase = true
  }

  const params = enabled(request.params)
  if (params.length > 0) {
    const query = params
      .map((p) => {
        const key = hasPlaceholders(p.key) ? p.key : encodeURIComponent(p.key)
        const value = hasPlaceholders(p.value) ? p.value : encodeURIComponent(p.value)
        return `${key}=${value}`
      })
      .join('&')
    urlString += `${urlString.includes('?') ? '&' : '?'}${query}`
  }

  const parts = interpolateParts(urlString)
  if (usesBase && ctx.baseUrlConst !== null) {
    parts.unshift(tExpr(id(ctx.baseUrlConst)))
  }
  const isPlain = parts.every((p) => p.kind === 'text')
  if (isPlain) return str(urlString)
  return template(parts)
}

function buildHeaderProps(request: HttpRequestDef, ctx: GenContext): ObjectProp[] {
  const props: ObjectProp[] = []
  const headers = enabled(request.headers)
  const hasContentType = headers.some((h) => h.key.toLowerCase() === 'content-type')

  for (const header of headers) {
    props.push(prop(header.key, interpolate(header.value)))
  }
  if (!hasContentType && request.body.mode === 'json') {
    props.push(prop('Content-Type', str('application/json')))
  }
  if (!hasContentType && request.body.mode === 'form-urlencoded') {
    props.push(prop('Content-Type', str('application/x-www-form-urlencoded')))
  }

  switch (request.auth.type) {
    case 'bearer':
      props.push(prop('Authorization', template([tText('Bearer '), ...interpolateParts(request.auth.token)])))
      break
    case 'basic': {
      ctx.needs.b64encode = true
      const credentials = template([
        ...interpolateParts(request.auth.username),
        tText(':'),
        ...interpolateParts(request.auth.password)
      ])
      props.push(
        prop('Authorization', template([tText('Basic '), tExpr(call(id('b64encode'), [credentials]))]))
      )
      break
    }
    case 'api-key':
      props.push(prop(request.auth.headerName, interpolate(request.auth.value)))
      break
    case 'none':
      break
  }

  return props
}

function buildRequestParams(request: HttpRequestDef, ctx: GenContext): Expr | null {
  const props: ObjectProp[] = []

  const headerProps = buildHeaderProps(request, ctx)
  if (headerProps.length > 0) props.push(prop('headers', obj(headerProps)))

  const cookies = enabled(request.cookies)
  if (cookies.length > 0) {
    props.push(prop('cookies', obj(cookies.map((c) => prop(c.key, interpolate(c.value))))))
  }

  const tags = enabled(request.tags)
  const tagProps = tags.map((t) => prop(t.key, interpolate(t.value)))
  tagProps.unshift(prop('name', str(request.name)))
  props.push(prop('tags', obj(tagProps, false)))

  if (request.timeout.trim() !== '' && request.timeout !== '60s') {
    props.push(prop('timeout', str(request.timeout)))
  }

  if (props.length === 0) return null
  return obj(props)
}

function buildBodyExpr(request: HttpRequestDef, ctx: GenContext): Expr | null {
  const { body } = request
  switch (body.mode) {
    case 'none':
      return null
    case 'json': {
      try {
        const parsed = JSON.parse(body.raw) as JsonValue
        return call(member(id('JSON'), 'stringify'), [jsonToExpr(parsed)])
      } catch {
        return interpolate(body.raw)
      }
    }
    case 'text':
      return interpolate(body.raw)
    case 'form-urlencoded':
      return obj(enabled(body.fields).map((f) => prop(f.key, interpolate(f.value))))
    case 'multipart':
      return obj(
        enabled(body.fields).map((field) => {
          if (field.value.startsWith('@')) {
            // Strip curl's ;type=…/;filename=… modifiers from the path.
            const path = field.value.slice(1).split(';')[0]
            const fileName = path.split('/').pop() ?? path
            let constName = ctx.fileConsts.get(path)
            if (constName === undefined) {
              constName = ctx.moduleNames.alloc(
                toIdentifier(`file ${fileName}`, `file${ctx.fileConsts.size}`)
              )
              ctx.fileConsts.set(path, constName)
            }
            return prop(field.key, call(member(id('http'), 'file'), [id(constName), str(fileName)]))
          }
          return prop(field.key, interpolate(field.value))
        })
      )
  }
}

/* ------------------------------------------------------------------ */
/* Checks                                                              */
/* ------------------------------------------------------------------ */

function literalValue(value: string): Expr {
  const trimmed = value.trim()
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return num(Number(trimmed))
  if (trimmed === 'true') return bool(true)
  if (trimmed === 'false') return bool(false)
  return interpolate(value)
}

const OPERATOR_JS: Record<string, string> = {
  eq: '===',
  neq: '!==',
  lt: '<',
  lte: '<=',
  gt: '>',
  gte: '>='
}

function checkPredicate(checkDef: CheckDef): Expr {
  const r = id('r')
  switch (checkDef.kind) {
    case 'status':
      return arrow(
        ['r'],
        binary(OPERATOR_JS[checkDef.operator] ?? '===', member(r, 'status'), literalValue(checkDef.value))
      )
    case 'duration':
      return arrow(
        ['r'],
        binary(
          OPERATOR_JS[checkDef.operator] ?? '<',
          member(member(r, 'timings'), 'duration'),
          literalValue(checkDef.value)
        )
      )
    case 'body-contains':
      return arrow(
        ['r'],
        binary(
          '&&',
          binary('!==', member(r, 'body'), { kind: 'null' }),
          call(member(call(id('String'), [member(r, 'body')]), 'includes'), [interpolate(checkDef.value)])
        )
      )
    case 'json-path': {
      const jsonCall = call(member(r, 'json'), [str(checkDef.target)])
      if (checkDef.operator === 'exists') {
        return arrow(['r'], binary('!==', jsonCall, id('undefined')))
      }
      if (checkDef.operator === 'contains') {
        return arrow(
          ['r'],
          binary(
            '&&',
            binary('!==', jsonCall, id('undefined')),
            call(member(call(id('String'), [jsonCall]), 'includes'), [interpolate(checkDef.value)])
          )
        )
      }
      return arrow(
        ['r'],
        binary(OPERATOR_JS[checkDef.operator] ?? '===', jsonCall, literalValue(checkDef.value))
      )
    }
    case 'header': {
      const header = index(member(r, 'headers'), str(checkDef.target))
      if (checkDef.operator === 'exists') {
        return arrow(['r'], binary('!==', header, id('undefined')))
      }
      if (checkDef.operator === 'contains') {
        return arrow(
          ['r'],
          binary(
            '&&',
            binary('!==', header, id('undefined')),
            call(member(header, 'includes'), [interpolate(checkDef.value)])
          )
        )
      }
      return arrow(
        ['r'],
        binary(OPERATOR_JS[checkDef.operator] ?? '===', header, literalValue(checkDef.value))
      )
    }
  }
}

function buildChecksStmt(responseVar: string, checks: CheckDef[], ctx: GenContext): Stmt {
  ctx.needs.check = true
  return exprStmt(
    call(id('check'), [id(responseVar), obj(checks.map((c) => prop(c.label, checkPredicate(c))))])
  )
}

/* ------------------------------------------------------------------ */
/* Steps                                                               */
/* ------------------------------------------------------------------ */

function requestStmts(request: HttpRequestDef, ctx: GenContext, names: NameAllocator): Stmt[] {
  const stmts: Stmt[] = []
  const methodFn = METHOD_FN[request.method]
  const url = buildUrlExpr(request, ctx)
  const body = buildBodyExpr(request, ctx)
  const params = buildRequestParams(request, ctx)

  const args: Expr[] = [url]
  if (request.method === 'GET' || request.method === 'HEAD') {
    if (params !== null) args.push(params)
  } else {
    args.push(body ?? { kind: 'null' })
    if (params !== null) args.push(params)
  }

  const callExpr = call(member(id('http'), methodFn), args)
  const needsVar = request.checks.length > 0 || request.extractors.length > 0

  if (needsVar) {
    const resVar = names.alloc('res')
    stmts.push(constStmt(resVar, callExpr))
    if (request.checks.length > 0) stmts.push(buildChecksStmt(resVar, request.checks, ctx))
    for (const extractor of request.extractors) {
      const varName = names.alloc(preferredIdentifier(extractor.variable, 'value'))
      currentNameMap.set(extractor.variable, varName)
      const source =
        extractor.source === 'json'
          ? call(member(id(resVar), 'json'), [str(extractor.expression)])
          : extractor.source === 'header'
            ? index(member(id(resVar), 'headers'), str(extractor.expression))
            : member(id(resVar), 'status')
      stmts.push(constStmt(varName, source))
    }
  } else {
    stmts.push(exprStmt(callExpr))
  }

  return stmts
}

function stepStmts(step: Step, ctx: GenContext, names: NameAllocator): Stmt[] {
  switch (step.kind) {
    case 'request':
      return requestStmts(step.request, ctx, names)

    case 'batch': {
      const responsesVar = names.alloc('responses')
      const entries = step.requests.map((request) => {
        const url = buildUrlExpr(request, ctx)
        const body = buildBodyExpr(request, ctx)
        const params = buildRequestParams(request, ctx)
        const tuple: Expr[] = [str(request.method), url]
        if (body !== null || params !== null) tuple.push(body ?? { kind: 'null' })
        if (params !== null) tuple.push(params)
        return prop(request.name, arr(tuple))
      })
      const stmts: Stmt[] = [constStmt(responsesVar, call(member(id('http'), 'batch'), [obj(entries)]))]
      for (const request of step.requests) {
        if (request.checks.length > 0) {
          ctx.needs.check = true
          stmts.push(
            exprStmt(
              call(id('check'), [
                index(id(responsesVar), str(request.name)),
                obj(request.checks.map((c) => prop(c.label, checkPredicate(c))))
              ])
            )
          )
        }
      }
      return stmts
    }

    case 'group': {
      ctx.needs.group = true
      const inner = step.children.flatMap((child) => stepStmts(child, ctx, names))
      return [exprStmt(call(id('group'), [str(step.name), arrow([], inner)]))]
    }

    case 'sleep':
      ctx.needs.sleep = true
      return [exprStmt(call(id('sleep'), [num(step.seconds)]))]

    case 'think-time': {
      ctx.needs.sleep = true
      // sleep(Math.random() * (max - min) + min) — randomized think time
      const spread = step.maxSeconds - step.minSeconds
      const randomExpr = binary(
        '+',
        binary('*', call(member(id('Math'), 'random'), []), num(Number(spread.toFixed(3)))),
        num(step.minSeconds)
      )
      return [exprStmt(call(id('sleep'), [randomExpr]))]
    }

    case 'conditional': {
      const consequent = step.whenTrue.flatMap((child) => stepStmts(child, ctx, names))
      const alternate = step.whenFalse.flatMap((child) => stepStmts(child, ctx, names))
      return [
        ifStmt(
          raw(step.condition),
          consequent.length > 0 ? consequent : [comment('no steps configured for this branch')],
          alternate.length > 0 ? alternate : undefined
        )
      ]
    }

    case 'loop': {
      const loopVar = names.alloc('i')
      const body = step.children.flatMap((child) => stepStmts(child, ctx, names))
      return [forCount(loopVar, num(step.iterations), body)]
    }
  }
}

/* ------------------------------------------------------------------ */
/* Options                                                             */
/* ------------------------------------------------------------------ */

function thresholdEntry(threshold: ThresholdDef): Expr {
  const expression = `${threshold.aggregation}${threshold.operator}${threshold.value}`
  if (!threshold.abortOnFail) return str(expression)
  const props: ObjectProp[] = [prop('threshold', str(expression)), prop('abortOnFail', bool(true))]
  if (threshold.delayAbortEval.trim() !== '') {
    props.push(prop('delayAbortEval', str(threshold.delayAbortEval)))
  }
  return obj(props, false)
}

/**
 * The key a threshold is emitted under. Scenario-scoped gates use k6's tag
 * selector syntax so each workload is judged on its own samples only:
 * `http_req_duration{scenario:smoke}`.
 * https://grafana.com/docs/k6/latest/using-k6/thresholds/#thresholds-on-tags
 */
function thresholdSelector(metric: string, scenarioKey: string | null): string {
  return scenarioKey === null ? metric : `${metric}{scenario:${scenarioKey}}`
}

/**
 * Collects suite-wide and scenario-scoped gates into one `thresholds` object,
 * grouping every expression that shares a selector.
 */
function thresholdsExpr(entries: Array<{ threshold: ThresholdDef; scenarioKey: string | null }>): Expr {
  const bySelector = new Map<string, ThresholdDef[]>()
  for (const entry of entries) {
    const selector = thresholdSelector(entry.threshold.metric, entry.scenarioKey)
    const list = bySelector.get(selector) ?? []
    list.push(entry.threshold)
    bySelector.set(selector, list)
  }
  return obj(
    Array.from(bySelector.entries()).map(([selector, defs]) => prop(selector, arr(defs.map(thresholdEntry))))
  )
}

function executorProps(config: ExecutorConfig): ObjectProp[] {
  const props: ObjectProp[] = [prop('executor', str(config.type))]
  const stagesExpr = arr(
    config.stages.map((stage) =>
      obj([prop('duration', str(stage.duration)), prop('target', num(stage.target))], false)
    )
  )

  switch (config.type) {
    case 'shared-iterations':
    case 'per-vu-iterations':
      props.push(prop('vus', num(config.vus)))
      props.push(prop('iterations', num(config.iterations)))
      if (config.maxDuration !== '10m') props.push(prop('maxDuration', str(config.maxDuration)))
      break
    case 'constant-vus':
      props.push(prop('vus', num(config.vus)))
      props.push(prop('duration', str(config.duration)))
      break
    case 'ramping-vus':
      props.push(prop('startVUs', num(config.startVUs)))
      props.push(prop('stages', stagesExpr))
      if (config.gracefulRampDown !== '30s')
        props.push(prop('gracefulRampDown', str(config.gracefulRampDown)))
      break
    case 'constant-arrival-rate':
      props.push(prop('rate', num(config.rate)))
      if (config.timeUnit !== '1s') props.push(prop('timeUnit', str(config.timeUnit)))
      props.push(prop('duration', str(config.duration)))
      props.push(prop('preAllocatedVUs', num(config.preAllocatedVUs)))
      if (config.maxVUs > 0) props.push(prop('maxVUs', num(config.maxVUs)))
      break
    case 'ramping-arrival-rate':
      props.push(prop('startRate', num(config.startRate)))
      if (config.timeUnit !== '1s') props.push(prop('timeUnit', str(config.timeUnit)))
      props.push(prop('stages', stagesExpr))
      props.push(prop('preAllocatedVUs', num(config.preAllocatedVUs)))
      if (config.maxVUs > 0) props.push(prop('maxVUs', num(config.maxVUs)))
      break
    case 'externally-controlled':
      props.push(prop('vus', num(config.vus)))
      props.push(prop('maxVUs', num(config.maxVUs)))
      props.push(prop('duration', str(config.duration)))
      break
  }

  return props
}

function scenariosExpr(scenarios: EmittedScenario[]): Expr {
  return obj(
    scenarios.map(({ scenario, key, execName }) => {
      const props = executorProps(scenario.executor)
      if (execName !== null) props.push(prop('exec', str(execName)))
      if (scenario.startTime.trim() !== '' && scenario.startTime !== '0s') {
        props.push(prop('startTime', str(scenario.startTime)))
      }
      if (scenario.gracefulStop.trim() !== '' && scenario.gracefulStop !== '30s') {
        props.push(prop('gracefulStop', str(scenario.gracefulStop)))
      }
      const tags = enabled(scenario.tags)
      if (tags.length > 0) {
        props.push(
          prop(
            'tags',
            obj(
              tags.map((t) => prop(t.key, str(t.value))),
              false
            )
          )
        )
      }
      const env = enabled(scenario.env)
      if (env.length > 0) {
        props.push(
          prop(
            'env',
            obj(
              env.map((e) => prop(e.key, str(e.value))),
              false
            )
          )
        )
      }
      return prop(key, obj(props))
    })
  )
}

function globalOptionProps(options: GlobalOptions): ObjectProp[] {
  const props: ObjectProp[] = []
  if (options.userAgent.trim() !== '') props.push(prop('userAgent', str(options.userAgent)))
  if (options.maxRedirects !== 10) props.push(prop('maxRedirects', num(options.maxRedirects)))
  if (options.insecureSkipTLSVerify) props.push(prop('insecureSkipTLSVerify', bool(true)))
  if (options.discardResponseBodies) props.push(prop('discardResponseBodies', bool(true)))
  if (options.noConnectionReuse) props.push(prop('noConnectionReuse', bool(true)))
  if (options.throw) props.push(prop('throw', bool(true)))

  const dnsDefault =
    options.dns.ttl === '5m' && options.dns.select === 'random' && options.dns.policy === 'preferIPv4'
  if (!dnsDefault) {
    props.push(
      prop(
        'dns',
        obj(
          [
            prop('ttl', str(options.dns.ttl)),
            prop('select', str(options.dns.select)),
            prop('policy', str(options.dns.policy))
          ],
          false
        )
      )
    )
  }

  const defaultStats = ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)']
  if (options.summaryTrendStats.join(',') !== defaultStats.join(',')) {
    props.push(prop('summaryTrendStats', arr(options.summaryTrendStats.map(str))))
  }

  const tags = enabled(options.tags)
  if (tags.length > 0) {
    props.push(
      prop(
        'tags',
        obj(
          tags.map((t) => prop(t.key, str(t.value))),
          false
        )
      )
    )
  }
  if (options.setupTimeout !== '60s') props.push(prop('setupTimeout', str(options.setupTimeout)))
  if (options.teardownTimeout !== '60s') props.push(prop('teardownTimeout', str(options.teardownTimeout)))
  return props
}

/* ------------------------------------------------------------------ */
/* Scenario planning                                                   */
/* ------------------------------------------------------------------ */

/** A scenario as it will appear in `options.scenarios`. */
interface EmittedScenario {
  scenario: ScenarioDef
  /** Key in options.scenarios — and therefore the value of its `scenario` tag. */
  key: string
  /** Exported function it runs, or null when it is the default export. */
  execName: string | null
  journeyIndex: number
}

/** One journey body, plus the scenarios that execute it. */
interface EmittedJourney {
  steps: Step[]
  /** Exported function name, or null when emitted as the default export. */
  name: string | null
  scenarioCount: number
}

/**
 * Structural fingerprint of a journey. Node ids are excluded, so scenarios wired
 * to the same steps — or to identical copies of them — collapse onto a single
 * exported function instead of duplicating the whole body. Several scenarios
 * sharing one `exec` is the shape k6 documents for exactly this case.
 * https://grafana.com/docs/k6/latest/using-k6/scenarios/advanced-examples/
 */
function journeySignature(steps: Step[]): string {
  return JSON.stringify(steps, (key, value: unknown) => (key === 'id' ? undefined : value))
}

function planScenarios(
  plan: TestPlan,
  names: NameAllocator
): { scenarios: EmittedScenario[]; journeys: EmittedJourney[] } {
  const active = activeScenarioPlans(plan)

  const journeys: EmittedJourney[] = []
  const journeyIndexBySignature = new Map<string, number>()
  const scenarios: EmittedScenario[] = []

  for (const entry of active) {
    const signature = journeySignature(entry.steps)
    let journeyIndex = journeyIndexBySignature.get(signature)
    if (journeyIndex === undefined) {
      journeyIndex = journeys.length
      journeys.push({ steps: entry.steps, name: null, scenarioCount: 0 })
      journeyIndexBySignature.set(signature, journeyIndex)
    }
    journeys[journeyIndex].scenarioCount += 1
    scenarios.push({
      scenario: entry.scenario,
      key: scenarioKey(entry.scenario.name),
      execName: null,
      journeyIndex
    })
  }

  /* A lone scenario keeps the idiomatic `export default function`. */
  if (scenarios.length > 1) {
    for (const [index, journey] of journeys.entries()) {
      const soleScenario = scenarios.find((entry) => entry.journeyIndex === index)
      journey.name = names.alloc(
        journey.scenarioCount === 1 && soleScenario !== undefined ? soleScenario.key : 'journey'
      )
    }
    for (const emitted of scenarios) {
      emitted.execName = journeys[emitted.journeyIndex].name
    }
  }

  return { scenarios, journeys }
}

/* ------------------------------------------------------------------ */
/* Program assembly                                                    */
/* ------------------------------------------------------------------ */

const METRIC_CLASS: Record<string, string> = {
  trend: 'Trend',
  counter: 'Counter',
  rate: 'Rate',
  gauge: 'Gauge'
}

/** Value of `-e SCENARIO=` that runs every scenario in one test. */
export const ALL_SCENARIOS = 'all'

/**
 * Emits the scenario selector k6 documents for choosing a workload at run time:
 * building `options.scenarios` from an env var. k6 has no CLI flag for this
 * (grafana/k6#2780), so the officially recommended approach is to shape the
 * object in the init context.
 * https://grafana.com/docs/k6/latest/using-k6/scenarios/advanced-examples/
 */
function scenarioSelectorFn(
  fnName: string,
  scenariosConst: string,
  keys: string[],
  defaultKey: string
): Stmt {
  const requested = 'requested'
  const available = [...keys, ALL_SCENARIOS].join(', ')
  return func(
    fnName,
    [],
    [
      constStmt(requested, binary('||', member(id('__ENV'), 'SCENARIO'), str(defaultKey))),
      ifStmt(binary('===', id(requested), str(ALL_SCENARIOS)), [returnStmt(id(scenariosConst))]),
      ifStmt(binary('===', index(id(scenariosConst), id(requested)), id('undefined')), [
        exprStmt(
          raw(`throw new Error(\`Unknown scenario "\${${requested}}" — expected one of: ${available}\`)`)
        )
      ]),
      returnStmt(obj([propComputed(id(requested), index(id(scenariosConst), id(requested)))], false))
    ]
  )
}

function journeyFunction(journey: EmittedJourney, ctx: GenContext): Stmt {
  const names = new NameAllocator(ctx.moduleNames.list())
  currentNameMap = new Map(ctx.nameMap)
  const body = journey.steps.flatMap((step) => stepStmts(step, ctx, names))
  if (body.length === 0) body.push(comment('no steps configured for this scenario'))
  const isDefault = journey.name === null
  return func(journey.name ?? '', [], body, { isDefault, exported: !isDefault })
}

export function generateProgram(plan: TestPlan): Program {
  const moduleNames = new NameAllocator([
    'http',
    'check',
    'group',
    'sleep',
    'options',
    'setup',
    'teardown',
    'open',
    'SharedArray',
    'Trend',
    'Counter',
    'Rate',
    'Gauge',
    'b64encode',
    '__ENV',
    '__VU',
    '__ITER',
    'JSON',
    'Math',
    'String'
  ])

  const ctx: GenContext = {
    plan,
    needs: { check: false, group: false, sleep: false, b64encode: false, sharedArray: false },
    metricConsts: new Map(),
    fileConsts: new Map(),
    baseUrlConst: plan.meta.baseUrl.trim() !== '' ? moduleNames.alloc('BASE_URL') : null,
    moduleNames,
    nameMap: new Map()
  }

  /* Pre-allocate every module-scope identifier BEFORE generating function
     bodies, so {{placeholders}} inside requests resolve to real names and no
     two declarations ever collide (env var / metric / shared data / fn).
     User-facing names are allocated first so they keep their preferred
     identifier and only generated names ever get suffixed. */
  if (ctx.baseUrlConst !== null) ctx.nameMap.set('BASE_URL', ctx.baseUrlConst)

  const envDecls: Array<{ emitted: string; envKey: string; defaultValue: string; required: boolean }> = []
  for (const envVar of plan.envVars) {
    if (envVar.name.trim() === '' || envVar.name === 'BASE_URL') continue
    const emitted = moduleNames.alloc(preferredIdentifier(envVar.name, 'env'))
    ctx.nameMap.set(envVar.name, emitted)
    envDecls.push({
      emitted,
      envKey: envVar.name,
      defaultValue: envVar.defaultValue,
      required: envVar.required
    })
  }

  const metricDecls: Array<{ emitted: string; metric: TestPlan['customMetrics'][number] }> = []
  for (const metric of plan.customMetrics) {
    const emitted = moduleNames.alloc(preferredIdentifier(metric.name, 'metric'))
    ctx.metricConsts.set(metric.name, emitted)
    ctx.nameMap.set(metric.name, emitted)
    metricDecls.push({ emitted, metric })
  }

  const sharedDecls: Array<{ emitted: string; dataName: string; parsed: JsonValue }> = []
  for (const data of plan.sharedData) {
    let parsed: JsonValue = []
    try {
      parsed = JSON.parse(data.json) as JsonValue
    } catch {
      parsed = []
    }
    const emitted = moduleNames.alloc(preferredIdentifier(data.name, 'sharedData'))
    ctx.nameMap.set(data.name, emitted)
    sharedDecls.push({ emitted, dataName: data.name, parsed })
  }

  /* Which scenarios are emitted, and which journeys they share. */
  const { scenarios, journeys } = planScenarios(plan, moduleNames)
  const multiScenario = scenarios.length > 1
  const scenariosConst = multiScenario ? moduleNames.alloc('scenarios') : null
  const selectorFn = multiScenario ? moduleNames.alloc('selectedScenarios') : null

  /* Generate function bodies (populates `needs` and discovers file handles). */
  const journeyFns = journeys.map((journey) => journeyFunction(journey, ctx))

  const setupNames = new NameAllocator(moduleNames.list())
  currentNameMap = new Map(ctx.nameMap)
  const setupBody = plan.hasSetup ? plan.setupSteps.flatMap((step) => stepStmts(step, ctx, setupNames)) : []
  const teardownNames = new NameAllocator(moduleNames.list())
  currentNameMap = new Map(ctx.nameMap)
  const teardownBody = plan.hasTeardown
    ? plan.teardownSteps.flatMap((step) => stepStmts(step, ctx, teardownNames))
    : []

  /* Only module-scope interpolation happens from here on (shared data JSON). */
  currentNameMap = new Map(ctx.nameMap)

  const body: Stmt[] = []

  /* Header */
  body.push(comment(`${plan.meta.name || 'k6 load test'} — generated by K6 Studio Builder`))
  if (plan.meta.description.trim() !== '') body.push(comment(plan.meta.description.trim()))
  body.push(blank())

  /* Imports */
  body.push(importStmt('k6/http', [], 'http'))
  const k6Named = (['check', 'group', 'sleep'] as const).filter((name) => ctx.needs[name])
  if (k6Named.length > 0) body.push(importStmt('k6', [...k6Named]))
  const metricClasses = Array.from(new Set(plan.customMetrics.map((m) => METRIC_CLASS[m.type]))).sort()
  if (metricClasses.length > 0) body.push(importStmt('k6/metrics', metricClasses))
  if (plan.sharedData.length > 0) body.push(importStmt('k6/data', ['SharedArray']))
  if (ctx.needs.b64encode) body.push(importStmt('k6/encoding', ['b64encode']))
  body.push(blank())

  /* Environment variables */
  const envStmts: Stmt[] = []
  if (ctx.baseUrlConst !== null) {
    envStmts.push(
      constStmt(
        ctx.baseUrlConst,
        binary('||', member(id('__ENV'), 'BASE_URL'), str(plan.meta.baseUrl.trim().replace(/\/$/, '')))
      )
    )
  }
  for (const decl of envDecls) {
    const access = member(id('__ENV'), decl.envKey)
    envStmts.push(
      constStmt(
        decl.emitted,
        decl.defaultValue.trim() !== '' ? binary('||', access, str(decl.defaultValue)) : access
      )
    )
  }
  if (envStmts.length > 0) {
    body.push(comment('Environment configuration (override with k6 run -e NAME=value)'))
    body.push(...envStmts)
    body.push(blank())
  }

  /* Required env vars runtime guard */
  const required = envDecls.filter((decl) => decl.required && decl.defaultValue.trim() === '')
  for (const decl of required) {
    body.push(
      ifStmt(binary('===', id(decl.emitted), id('undefined')), [
        exprStmt(
          raw(
            `throw new Error('Missing required environment variable ${decl.envKey} (k6 run -e ${decl.envKey}=…)')`
          )
        )
      ])
    )
  }
  if (required.length > 0) body.push(blank())

  /* Custom metrics */
  if (metricDecls.length > 0) {
    body.push(comment('Custom metrics'))
    for (const { emitted, metric } of metricDecls) {
      const args: Expr[] = [str(metric.name)]
      if (metric.type === 'trend' && metric.isTime) args.push(bool(true))
      body.push(constStmt(emitted, { kind: 'call', callee: raw(`new ${METRIC_CLASS[metric.type]}`), args }))
    }
    body.push(blank())
  }

  /* Shared data */
  if (sharedDecls.length > 0) {
    body.push(comment('Test data shared across all VUs in a single memory copy'))
    for (const { emitted, dataName, parsed } of sharedDecls) {
      body.push(
        constStmt(emitted, {
          kind: 'call',
          callee: raw('new SharedArray'),
          args: [str(dataName), arrow([], [returnStmt(jsonToExpr(parsed))])]
        })
      )
    }
    body.push(blank())
  }

  /* Multipart file handles (init context) */
  if (ctx.fileConsts.size > 0) {
    body.push(comment('Files are opened in the init context, once per VU'))
    for (const [path, constName] of ctx.fileConsts.entries()) {
      body.push(constStmt(constName, call(id('open'), [str(path), str('b')])))
    }
    body.push(blank())
  }

  /* Scenarios — declared separately when there is more than one, so a single
     scenario can be selected at run time without editing the script. */
  const scenariosObj = scenariosExpr(scenarios)
  if (scenariosConst !== null && selectorFn !== null) {
    const keys = scenarios.map((entry) => entry.key)
    const defaultKey = plan.execution === 'all-together' ? ALL_SCENARIOS : keys[0]
    const usage = [
      `Available: ${keys.join(', ')}`,
      `  k6 run <script>                       runs ${defaultKey}`,
      `  k6 run -e SCENARIO=<name> <script>    runs one scenario`,
      `  k6 run -e SCENARIO=${ALL_SCENARIOS} <script>       runs every scenario in a single test`
    ].join('\n')
    body.push(
      comment(
        plan.execution === 'all-together'
          ? `The ${keys.length} scenarios below form one combined workload: they run together in a\nsingle test, sequenced by their startTime.\n${usage}`
          : `The ${keys.length} scenarios below are alternative workloads over the same journey, so one\nruns per invocation — a four-hour soak next to a smoke test measures neither.\n${usage}`
      )
    )
    body.push(constStmt(scenariosConst, scenariosObj))
    body.push(blank())
    body.push(scenarioSelectorFn(selectorFn, scenariosConst, keys, defaultKey))
    body.push(blank())
  }

  /* Options */
  const optionProps: ObjectProp[] = [
    prop('scenarios', selectorFn === null ? scenariosObj : call(id(selectorFn), []))
  ]
  const thresholdEntries = [
    ...plan.thresholds.map((threshold) => ({ threshold, scenarioKey: null })),
    ...scenarios.flatMap((entry) =>
      entry.scenario.thresholds.map((threshold) => ({ threshold, scenarioKey: entry.key }))
    )
  ]
  if (thresholdEntries.length > 0) optionProps.push(prop('thresholds', thresholdsExpr(thresholdEntries)))
  optionProps.push(...globalOptionProps(plan.options))
  body.push(constStmt('options', obj(optionProps), true))
  body.push(blank())

  /* setup / teardown */
  if (plan.hasSetup) {
    body.push(comment('Runs once before the test starts; its return value is passed to every iteration'))
    body.push(
      func('setup', [], setupBody.length > 0 ? setupBody : [comment('no setup steps configured')], {
        exported: true
      })
    )
    body.push(blank())
  }

  /* Journey functions — one per distinct chain of steps, shared by every
     scenario wired to it. */
  journeyFns.forEach((fn, indexNum) => {
    const journey = journeys[indexNum]
    if (journey.scenarioCount > 1) {
      const sharing = scenarios
        .filter((entry) => entry.journeyIndex === indexNum)
        .map((entry) => entry.key)
        .join(', ')
      body.push(comment(`The journey shared by these scenarios: ${sharing}`))
    }
    body.push(fn)
    if (indexNum < journeyFns.length - 1) body.push(blank())
  })

  if (plan.hasTeardown) {
    body.push(blank())
    body.push(comment('Runs once after the test finishes'))
    body.push(
      func(
        'teardown',
        ['data'],
        teardownBody.length > 0 ? teardownBody : [comment('no teardown steps configured')],
        {
          exported: true
        }
      )
    )
  }

  return { body }
}

/** TestPlan → executable k6 script source */
export function generateScript(plan: TestPlan): string {
  return printProgram(generateProgram(plan))
}
