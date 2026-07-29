import { mkdirSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  createCheck,
  createGlobalOptions,
  createKeyValue,
  createRequest,
  createScenario,
  createThreshold
} from '@/lib/dsl/defaults'
import type { TestPlan } from '@/lib/dsl/types'
import { generateScript } from './generate'

const OUT_DIR = process.env.K6_SMOKE_OUT ?? ''

describe.runIf(OUT_DIR !== '')('k6 binary smoke fixture', () => {
  it('writes a kitchen-sink script exercising every generator feature', () => {
    const s1 = { ...createScenario('login flow', 'ramping-vus'), typeId: 'load' as const }
    const s2 = {
      ...createScenario('browse', 'constant-arrival-rate'),
      typeId: 'capacity' as const,
      /* Gates scoped to this scenario alone — emitted as {scenario:browse}. */
      thresholds: [{ ...createThreshold('http_req_duration'), aggregation: 'p(99)' as const, value: '2000' }]
    }
    /* A third scenario sharing the first one's journey: one exported function,
       two entries in options.scenarios. */
    const s3 = { ...createScenario('login smoke', 'constant-vus'), typeId: 'smoke' as const }
    const login = createRequest({
      name: 'Login',
      method: 'POST',
      url: 'https://api.example.com/auth/login',
      headers: [createKeyValue('Content-Type', 'application/json')],
      body: { mode: 'json', raw: '{"username": "{{USERNAME}}", "password": "secret"}', fields: [] },
      checks: [createCheck('status'), createCheck('duration'), createCheck('json-path')],
      extractors: [{ id: 'x1', variable: 'authToken', source: 'json', expression: 'data.token' }]
    })
    login.checks[2].target = 'data.token'
    const me = createRequest({
      name: 'Me',
      url: 'https://api.example.com/me',
      auth: { type: 'bearer', token: '{{authToken}}' },
      cookies: [createKeyValue('session', 'abc')]
    })
    const basic = createRequest({
      name: 'Secure',
      url: 'https://api.example.com/secure',
      auth: { type: 'basic', username: 'admin', password: 'pw' }
    })

    const journey: TestPlan['scenarios'][number]['steps'] = [
      { kind: 'request', id: 'st1', request: login },
      { kind: 'think-time', id: 'st2', minSeconds: 1, maxSeconds: 3 },
      {
        kind: 'group',
        id: 'st3',
        name: 'Account',
        children: [{ kind: 'request', id: 'st4', request: me }]
      },
      {
        kind: 'conditional',
        id: 'st5',
        condition: '__ITER % 2 === 0',
        whenTrue: [{ kind: 'sleep', id: 'st6', seconds: 1 }],
        whenFalse: [{ kind: 'request', id: 'st7', request: basic }]
      },
      { kind: 'loop', id: 'st8', iterations: 2, children: [{ kind: 'sleep', id: 'st9', seconds: 0.5 }] }
    ]

    const plan: TestPlan = {
      meta: {
        name: 'Kitchen Sink',
        description: 'exercises all features',
        baseUrl: 'https://api.example.com'
      },
      execution: 'one-at-a-time',
      options: {
        ...createGlobalOptions(),
        userAgent: 'k6-studio/1.0',
        maxRedirects: 5,
        insecureSkipTLSVerify: true,
        tags: [createKeyValue('team', 'perf')]
      },
      scenarios: [
        { scenario: s1, steps: journey },
        { scenario: s3, steps: journey },
        {
          scenario: s2,
          steps: [
            {
              kind: 'batch',
              id: 'st10',
              name: 'Parallel',
              requests: [
                createRequest({ name: 'A', url: 'https://api.example.com/a' }),
                createRequest({
                  name: 'B',
                  method: 'POST',
                  url: 'https://api.example.com/b',
                  body: { mode: 'form-urlencoded', raw: '', fields: [createKeyValue('q', '1')] }
                })
              ]
            }
          ]
        }
      ],
      thresholds: [
        createThreshold('http_req_duration'),
        createThreshold('http_req_failed'),
        createThreshold('checks'),
        {
          ...createThreshold('http_req_duration'),
          aggregation: 'p(99)',
          value: '1500',
          abortOnFail: true,
          delayAbortEval: '10s'
        },
        { ...createThreshold('journey_time'), aggregation: 'p(95)', operator: '<', value: '4000' }
      ],
      customMetrics: [
        { id: 'm1', name: 'journey_time', type: 'trend', isTime: true, description: '' },
        { id: 'm2', name: 'login_failures', type: 'counter', isTime: false, description: '' },
        { id: 'm3', name: 'cache_hits', type: 'rate', isTime: false, description: '' },
        { id: 'm4', name: 'queue_depth', type: 'gauge', isTime: false, description: '' }
      ],
      envVars: [
        { id: 'e1', name: 'USERNAME', defaultValue: 'alice', required: false, description: '' },
        { id: 'e2', name: 'API_TOKEN', defaultValue: '', required: true, description: '' }
      ],
      sharedData: [{ id: 'd1', name: 'users', json: '[{"u": "alice"}, {"u": "bob"}]' }],
      hasSetup: true,
      setupSteps: [
        {
          kind: 'request',
          id: 'su1',
          request: createRequest({ name: 'Health', url: 'https://api.example.com/health' })
        }
      ],
      hasTeardown: true,
      teardownSteps: [{ kind: 'sleep', id: 'td1', seconds: 1 }]
    }

    const script = generateScript(plan)
    mkdirSync(OUT_DIR, { recursive: true })
    writeFileSync(`${OUT_DIR}/kitchen-sink.js`, script)
    expect(script).toContain('export const options')

    /* Fast-running variant for an actual k6 run against a mock server */
    const quick = structuredClone(plan)
    quick.hasSetup = false
    quick.hasTeardown = false
    for (const scenarioPlan of quick.scenarios) {
      scenarioPlan.scenario.executor.type = 'shared-iterations'
      scenarioPlan.scenario.executor.vus = 1
      scenarioPlan.scenario.executor.iterations = 2
      scenarioPlan.scenario.startTime = '0s'
    }
    quick.thresholds = quick.thresholds.filter((t) => !t.abortOnFail)
    const walk = (steps: (typeof quick.scenarios)[number]['steps']): void => {
      for (const step of steps) {
        if (step.kind === 'sleep') step.seconds = 0.1
        if (step.kind === 'think-time') {
          step.minSeconds = 0.05
          step.maxSeconds = 0.1
        }
        if (step.kind === 'group' || step.kind === 'loop') walk(step.children)
        if (step.kind === 'conditional') {
          walk(step.whenTrue)
          walk(step.whenFalse)
        }
      }
    }
    for (const scenarioPlan of quick.scenarios) walk(scenarioPlan.steps)
    writeFileSync(`${OUT_DIR}/quick.js`, generateScript(quick))

    /* Same suite as one combined workload: every scenario runs in a single test,
       so `options.scenarios` is not gated behind SCENARIO. */
    const together = structuredClone(quick)
    together.execution = 'all-together'
    writeFileSync(`${OUT_DIR}/mixed.js`, generateScript(together))
  })
})
