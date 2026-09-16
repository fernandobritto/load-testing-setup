import { describe, expect, it } from 'vitest'
import { createGlobalOptions, createRequest, createScenario, createThreshold } from '@/lib/dsl/defaults'
import type { TestPlan } from '@/lib/dsl/types'
import { generateScript } from './generate'

function basePlan(overrides: Partial<TestPlan> = {}): TestPlan {
  const scenario = createScenario('checkout', 'constant-vus')
  return {
    meta: { name: 'Demo', description: '', baseUrl: '' },
    options: createGlobalOptions(),
    execution: 'one-at-a-time',
    scenarios: [
      {
        scenario,
        steps: [
          {
            kind: 'request',
            id: 'step1',
            request: createRequest({ name: 'Get Users', url: 'https://api.example.com/users' })
          }
        ]
      }
    ],
    thresholds: [createThreshold('http_req_duration')],
    customMetrics: [],
    envVars: [],
    sharedData: [],
    hasSetup: false,
    setupSteps: [],
    hasTeardown: false,
    teardownSteps: [],
    ...overrides
  }
}

/** The generated script must be syntactically valid JavaScript */
function expectValidSyntax(script: string): void {
  const stripped = script
    .replace(/^import .*$/gm, '')
    .replace(/^export default function/gm, 'const __defaultFn = function')
    .replace(/^export /gm, '')
  expect(() => new Function(stripped)).not.toThrow()
}

describe('generateScript', () => {
  it('generates an executable script with modern imports and no semicolons', () => {
    const script = generateScript(basePlan())
    expect(script).toContain("import http from 'k6/http'")
    expect(script).toContain("import { check } from 'k6'")
    expect(script).toContain('export const options = {')
    expect(script).toContain("executor: 'constant-vus'")
    expect(script).toContain('export default function () {')
    expect(script).toContain("http.get('https://api.example.com/users'")
    expect(script).not.toMatch(/;\s*$/m)
    expect(script).not.toContain('TODO')
    expectValidSyntax(script)
  })

  it('emits thresholds in the official expression format', () => {
    const script = generateScript(basePlan())
    expect(script).toMatch(/http_req_duration: \['p\(95\)<500'\]/)
  })

  it('shares one exported function between scenarios that measure the same journey', () => {
    const plan = basePlan()
    const second = createScenario('browse', 'ramping-vus')
    plan.scenarios.push({ scenario: second, steps: plan.scenarios[0].steps })
    const script = generateScript(plan)

    /* Both scenarios point at a single journey function instead of duplicating
       the body — the shape k6 documents for scenarios sharing an exec. */
    expect(script).toContain("exec: 'journey'")
    expect(script).toContain('export function journey () {')
    expect(script.match(/export function /g)).toHaveLength(1)
    expect(script).not.toContain('export default')
    expect(script).toContain('The journey shared by these scenarios: checkout, browse')
    expectValidSyntax(script)
  })

  it('emits one function per distinct journey, named after its scenario', () => {
    const plan = basePlan()
    plan.scenarios.push({
      scenario: createScenario('browse', 'ramping-vus'),
      steps: [
        {
          kind: 'request',
          id: 'step2',
          request: createRequest({ name: 'List Products', url: 'https://api.example.com/products' })
        }
      ]
    })
    const script = generateScript(plan)
    expect(script).toContain("exec: 'checkout'")
    expect(script).toContain("exec: 'browse'")
    expect(script).toContain('export function checkout () {')
    expect(script).toContain('export function browse () {')
    expectValidSyntax(script)
  })

  it('selects a scenario at run time via SCENARIO, defaulting to the first', () => {
    const plan = basePlan()
    plan.scenarios.push({ scenario: createScenario('soak'), steps: plan.scenarios[0].steps })
    const script = generateScript(plan)

    expect(script).toContain('const scenarios = {')
    expect(script).toContain('scenarios: selectedScenarios()')
    expect(script).toContain("const requested = __ENV.SCENARIO || 'checkout'")
    expect(script).toContain("if (requested === 'all') {")
    expect(script).toContain('return { [requested]: scenarios[requested] }')
    expect(script).toContain('Unknown scenario')
    expectValidSyntax(script)
  })

  it('runs every scenario together when the suite is a combined workload', () => {
    const plan = basePlan({ execution: 'all-together' })
    plan.scenarios.push({ scenario: createScenario('background'), steps: plan.scenarios[0].steps })
    const script = generateScript(plan)
    expect(script).toContain("const requested = __ENV.SCENARIO || 'all'")
    expect(script).toContain('form one combined workload')
    expectValidSyntax(script)
  })

  it('scopes a scenario threshold to that scenario with a tag selector', () => {
    const plan = basePlan()
    plan.scenarios[0].scenario.thresholds = [
      { ...createThreshold('http_req_duration'), aggregation: 'p(99)', value: '900' }
    ]
    plan.scenarios.push({
      scenario: {
        ...createScenario('soak'),
        thresholds: [{ ...createThreshold('http_req_failed'), value: '0.02' }]
      },
      steps: plan.scenarios[0].steps
    })
    const script = generateScript(plan)

    expect(script).toContain("'http_req_duration{scenario:checkout}': ['p(99)<900']")
    expect(script).toContain("'http_req_failed{scenario:soak}': ['rate<0.02']")
    /* The suite-wide gate stays unscoped. */
    expect(script).toContain("http_req_duration: ['p(95)<500']")
    expectValidSyntax(script)
  })

  it('leaves disabled scenarios out of the generated script', () => {
    const plan = basePlan()
    plan.scenarios.push({
      scenario: { ...createScenario('soak'), enabled: false },
      steps: plan.scenarios[0].steps
    })
    const script = generateScript(plan)

    expect(script).not.toContain('soak')
    /* One scenario left: back to the plain default export, no selector. */
    expect(script).toContain('export default function () {')
    expect(script).not.toContain('selectedScenarios')
    expectValidSyntax(script)
  })

  it('rewrites base-url requests to a BASE_URL env const', () => {
    const plan = basePlan()
    plan.meta.baseUrl = 'https://api.example.com'
    const script = generateScript(plan)
    expect(script).toContain("const BASE_URL = __ENV.BASE_URL || 'https://api.example.com'")
    expect(script).toContain('http.get(`${BASE_URL}/users`')
    expectValidSyntax(script)
  })

  it('interpolates {{placeholders}} into template literals', () => {
    const plan = basePlan()
    plan.envVars = [{ id: 'e1', name: 'API_TOKEN', defaultValue: 'abc', required: false, description: '' }]
    const request = plan.scenarios[0].steps[0]
    if (request.kind === 'request') {
      request.request.auth = { type: 'bearer', token: '{{API_TOKEN}}' }
    }
    const script = generateScript(plan)
    expect(script).toContain("const API_TOKEN = __ENV.API_TOKEN || 'abc'")
    expect(script).toContain('Authorization: `Bearer ${API_TOKEN}`')
    expectValidSyntax(script)
  })

  it('generates sleep, think time, groups, loops and conditionals', () => {
    const plan = basePlan()
    plan.scenarios[0].steps = [
      { kind: 'sleep', id: 's1', seconds: 2 },
      { kind: 'think-time', id: 's2', minSeconds: 1, maxSeconds: 4 },
      {
        kind: 'group',
        id: 's3',
        name: 'Checkout',
        children: [
          {
            kind: 'request',
            id: 's4',
            request: createRequest({ name: 'Pay', method: 'POST', url: 'https://api.example.com/pay' })
          }
        ]
      },
      { kind: 'loop', id: 's5', iterations: 3, children: [{ kind: 'sleep', id: 's6', seconds: 1 }] },
      {
        kind: 'conditional',
        id: 's7',
        condition: '__ITER % 2 === 0',
        whenTrue: [{ kind: 'sleep', id: 's8', seconds: 1 }],
        whenFalse: []
      }
    ]
    const script = generateScript(plan)
    expect(script).toContain('sleep(2)')
    expect(script).toContain('sleep(Math.random() * 3 + 1)')
    expect(script).toContain("group('Checkout', () => {")
    expect(script).toContain('for (let i = 0; i < 3; i++) {')
    expect(script).toContain('if (__ITER % 2 === 0) {')
    expectValidSyntax(script)
  })

  it('generates custom metrics, shared data, setup and teardown', () => {
    const plan = basePlan({
      customMetrics: [{ id: 'm1', name: 'checkout_time', type: 'trend', isTime: true, description: '' }],
      sharedData: [{ id: 'd1', name: 'users', json: '[{"u": "alice"}]' }],
      hasSetup: true,
      setupSteps: [
        {
          kind: 'request',
          id: 'st1',
          request: createRequest({ name: 'Warmup', url: 'https://api.example.com/health' })
        }
      ],
      hasTeardown: true,
      teardownSteps: []
    })
    const script = generateScript(plan)
    expect(script).toContain("import { Trend } from 'k6/metrics'")
    expect(script).toContain("const checkout_time = new Trend('checkout_time', true)")
    expect(script).toContain("import { SharedArray } from 'k6/data'")
    expect(script).toContain("new SharedArray('users'")
    expect(script).toContain('export function setup () {')
    expect(script).toContain('export function teardown (data) {')
    expectValidSyntax(script)
  })

  it('generates http.batch for parallel batches', () => {
    const plan = basePlan()
    plan.scenarios[0].steps = [
      {
        kind: 'batch',
        id: 'b1',
        name: 'Parallel',
        requests: [
          createRequest({ name: 'A', url: 'https://api.example.com/a' }),
          createRequest({ name: 'B', url: 'https://api.example.com/b' })
        ]
      }
    ]
    const script = generateScript(plan)
    expect(script).toContain('http.batch({')
    expect(script).toContain("responses['A']")
    expectValidSyntax(script)
  })

  it('deduplicates repeated extractor variable names without redeclaring', () => {
    const plan = basePlan()
    const first = createRequest({ name: 'Login', method: 'POST', url: 'https://api.example.com/login' })
    first.extractors = [{ id: 'x1', variable: 'token', source: 'json', expression: 'data.token' }]
    const second = createRequest({ name: 'Refresh', method: 'POST', url: 'https://api.example.com/refresh' })
    second.extractors = [{ id: 'x2', variable: 'token', source: 'json', expression: 'data.token' }]
    plan.scenarios[0].steps = [
      { kind: 'request', id: 's1', request: first },
      { kind: 'request', id: 's2', request: second }
    ]
    const script = generateScript(plan)
    // Two `const token` in one function would be a SyntaxError; the second is renamed.
    const declarations = script.match(/const token\b/g) ?? []
    expect(declarations.length).toBeLessThanOrEqual(1)
    expectValidSyntax(script)
  })

  it('keeps env var / metric identifier collisions valid (no duplicate const)', () => {
    const plan = basePlan()
    plan.envVars = [{ id: 'e1', name: 'count', defaultValue: '1', required: false, description: '' }]
    plan.customMetrics = [{ id: 'm1', name: 'Count', type: 'counter', isTime: false, description: '' }]
    const script = generateScript(plan)
    expectValidSyntax(script)
  })

  it('round-trips an extracted variable into a downstream {{placeholder}}', () => {
    const plan = basePlan()
    const login = createRequest({ name: 'Login', method: 'POST', url: 'https://api.example.com/login' })
    login.extractors = [{ id: 'x1', variable: 'authToken', source: 'json', expression: 'data.token' }]
    const me = createRequest({ name: 'Me', url: 'https://api.example.com/me' })
    me.auth = { type: 'bearer', token: '{{authToken}}' }
    plan.scenarios[0].steps = [
      { kind: 'request', id: 's1', request: login },
      { kind: 'request', id: 's2', request: me }
    ]
    const script = generateScript(plan)
    expect(script).toContain("const authToken = res.json('data.token')")
    expect(script).toContain('Authorization: `Bearer ${authToken}`')
    expectValidSyntax(script)
  })

  it('encodes basic auth with b64encode', () => {
    const plan = basePlan()
    const step = plan.scenarios[0].steps[0]
    if (step.kind === 'request') step.request.auth = { type: 'basic', username: 'admin', password: 'secret' }
    const script = generateScript(plan)
    expect(script).toContain("import { b64encode } from 'k6/encoding'")
    expect(script).toContain('Basic ${b64encode(`admin:secret`)}')
    expectValidSyntax(script)
  })
})
