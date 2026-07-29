import { describe, expect, it } from 'vitest'
import { createGlobalOptions, createRequest, createScenario, createThreshold } from '@/lib/dsl/defaults'
import type { TestPlan } from '@/lib/dsl/types'
import { validatePlan } from './engine'

function validBasePlan(): TestPlan {
  return {
    meta: { name: 'Demo', description: '', baseUrl: '' },
    options: createGlobalOptions(),
    execution: 'one-at-a-time',
    scenarios: [
      {
        scenario: createScenario('main', 'constant-vus'),
        steps: [
          {
            kind: 'request',
            id: 'r1',
            request: createRequest({ name: 'Get Users', url: 'https://api.example.com/users' })
          }
        ]
      }
    ],
    thresholds: [createThreshold('http_req_duration'), createThreshold('checks')],
    customMetrics: [],
    envVars: [],
    sharedData: [],
    hasSetup: false,
    setupSteps: [],
    hasTeardown: false,
    teardownSteps: []
  }
}

describe('validatePlan', () => {
  it('accepts a well-formed plan', () => {
    const result = validatePlan(validBasePlan())
    expect(result.errors).toEqual([])
    expect(result.valid).toBe(true)
  })

  it('rejects a plan without scenarios', () => {
    const plan = validBasePlan()
    plan.scenarios = []
    const result = validatePlan(plan)
    expect(result.valid).toBe(false)
    expect(result.errors.some((issue) => issue.message.includes('no scenarios'))).toBe(true)
  })

  it('rejects a scenario without steps and a test without requests', () => {
    const plan = validBasePlan()
    plan.scenarios[0].steps = []
    const result = validatePlan(plan)
    expect(result.errors.some((issue) => issue.message.includes('no steps connected'))).toBe(true)
    expect(result.errors.some((issue) => issue.message.includes('no HTTP requests'))).toBe(true)
  })

  it('rejects invalid executor configuration', () => {
    const plan = validBasePlan()
    plan.scenarios[0].scenario.executor.type = 'constant-vus'
    plan.scenarios[0].scenario.executor.vus = 0
    plan.scenarios[0].scenario.executor.duration = 'nonsense'
    const result = validatePlan(plan)
    expect(result.errors.some((issue) => issue.message.includes('vus'))).toBe(true)
    expect(result.errors.some((issue) => issue.message.includes('not a valid duration'))).toBe(true)
  })

  it('rejects maxVUs below preAllocatedVUs on arrival-rate executors', () => {
    const plan = validBasePlan()
    plan.scenarios[0].scenario.executor.type = 'constant-arrival-rate'
    plan.scenarios[0].scenario.executor.preAllocatedVUs = 100
    plan.scenarios[0].scenario.executor.maxVUs = 10
    const result = validatePlan(plan)
    expect(result.errors.some((issue) => issue.message.includes('maxVUs'))).toBe(true)
  })

  it('rejects thresholds on unknown metrics and incompatible aggregations', () => {
    const plan = validBasePlan()
    plan.thresholds = [
      { ...createThreshold('does_not_exist') },
      { ...createThreshold('http_req_failed'), aggregation: 'p(95)' }
    ]
    const result = validatePlan(plan)
    expect(result.errors.some((issue) => issue.message.includes('unknown metric'))).toBe(true)
    expect(result.errors.some((issue) => issue.message.includes('not valid for rate metric'))).toBe(true)
  })

  it('rejects invalid request URLs and JSON bodies', () => {
    const plan = validBasePlan()
    const step = plan.scenarios[0].steps[0]
    if (step.kind === 'request') {
      step.request.url = 'not-a-url'
      step.request.body = { mode: 'json', raw: '{invalid', fields: [] }
    }
    const result = validatePlan(plan)
    expect(result.errors.some((issue) => issue.message.includes('must start with http'))).toBe(true)
    expect(result.errors.some((issue) => issue.message.includes('JSON body is invalid'))).toBe(true)
  })

  it('warns about unknown {{placeholders}}', () => {
    const plan = validBasePlan()
    const step = plan.scenarios[0].steps[0]
    if (step.kind === 'request') step.request.url = 'https://api.example.com/{{UNKNOWN_VAR}}'
    const result = validatePlan(plan)
    expect(result.warnings.some((issue) => issue.message.includes('UNKNOWN_VAR'))).toBe(true)
  })

  it('accepts {{VAR}} that resolves to an env var', () => {
    const plan = validBasePlan()
    plan.envVars = [{ id: 'e1', name: 'TENANT', defaultValue: 'acme', required: false, description: '' }]
    const step = plan.scenarios[0].steps[0]
    if (step.kind === 'request') step.request.url = 'https://api.example.com/{{TENANT}}/users'
    const result = validatePlan(plan)
    expect(result.valid).toBe(true)
  })

  it('rejects duplicate scenario names and env vars', () => {
    const plan = validBasePlan()
    plan.scenarios.push({
      scenario: { ...createScenario('main'), id: 'other' },
      steps: plan.scenarios[0].steps
    })
    plan.envVars = [
      { id: 'e1', name: 'TOKEN', defaultValue: '', required: false, description: '' },
      { id: 'e2', name: 'TOKEN', defaultValue: '', required: false, description: '' }
    ]
    const result = validatePlan(plan)
    expect(result.errors.some((issue) => issue.message.includes('Duplicate scenario name'))).toBe(true)
    expect(result.errors.some((issue) => issue.message.includes('Duplicate environment variable'))).toBe(true)
  })

  it('rejects a suite whose every scenario is disabled', () => {
    const plan = validBasePlan()
    plan.scenarios[0].scenario.enabled = false
    const result = validatePlan(plan)
    expect(result.valid).toBe(false)
    expect(result.errors.some((issue) => issue.message.includes('is disabled'))).toBe(true)
  })

  it('keeps a disabled scenario from blocking the export', () => {
    const plan = validBasePlan()
    plan.scenarios.push({ scenario: { ...createScenario('unwired'), enabled: false }, steps: [] })
    const result = validatePlan(plan)
    expect(result.valid).toBe(true)
    expect(result.warnings.some((issue) => issue.message.includes('no steps connected'))).toBe(true)
  })

  it('validates a scenario gate and reports it on the scenario', () => {
    const plan = validBasePlan()
    const { scenario } = plan.scenarios[0]
    scenario.thresholds = [{ ...createThreshold('does_not_exist') }]
    const result = validatePlan(plan)
    const issue = result.errors.find((entry) => entry.message.includes('unknown metric'))
    expect(issue).toBeDefined()
    expect(issue?.refId).toBe(scenario.id)
    expect(issue?.message).toContain('Scenario "main"')
  })

  it('accepts a scenario gate that only exists on that scenario', () => {
    const plan = validBasePlan()
    plan.thresholds = []
    plan.scenarios[0].scenario.thresholds = [createThreshold('http_req_duration'), createThreshold('checks')]
    const result = validatePlan(plan)
    expect(result.errors).toEqual([])
    expect(result.warnings.some((issue) => issue.message.includes('no quality gates'))).toBe(false)
  })

  it('warns when a scenario has no gates at all', () => {
    const plan = validBasePlan()
    plan.thresholds = []
    const result = validatePlan(plan)
    expect(result.warnings.some((issue) => issue.message.includes('no quality gates'))).toBe(true)
  })

  it('reports a shared journey once, not once per scenario', () => {
    const plan = validBasePlan()
    const step = plan.scenarios[0].steps[0]
    if (step.kind === 'request') step.request.url = 'not-a-url'
    plan.scenarios.push({ scenario: createScenario('second'), steps: plan.scenarios[0].steps })
    const result = validatePlan(plan)
    expect(result.errors.filter((issue) => issue.message.includes('must start with http'))).toHaveLength(1)
  })

  it('warns when a long-running scenario shares a combined workload', () => {
    const plan = validBasePlan()
    plan.execution = 'all-together'
    plan.scenarios.push({
      scenario: { ...createScenario('overnight'), typeId: 'soak' },
      steps: plan.scenarios[0].steps
    })
    const result = validatePlan(plan)
    expect(result.warnings.some((issue) => issue.message.includes('runs for hours'))).toBe(true)
  })

  it('flags syntax errors introduced by custom conditions', () => {
    const plan = validBasePlan()
    plan.scenarios[0].steps.push({
      kind: 'conditional',
      id: 'c1',
      condition: 'res.status ===',
      whenTrue: [{ kind: 'sleep', id: 's1', seconds: 1 }],
      whenFalse: []
    })
    const result = validatePlan(plan)
    expect(result.errors.some((issue) => issue.area === 'script')).toBe(true)
  })
})
