import { describe, expect, it } from 'vitest'
import { createGlobalOptions, createRequest } from '@/lib/dsl/defaults'
import { addScenarioToFlow, seedFlow, type Flow } from '@/lib/flow/clone'
import type { FlowNode } from '@/lib/flow/types'
import { sortScenarioTypeIds, type ScenarioTypeId } from '@/lib/k6/scenario-types'
import type { ProjectMeta, Suite } from '@/stores/project-store'
import { buildSuite, toArtifacts } from './build'

const META: ProjectMeta = {
  name: 'Checkout Perf',
  description: 'Checkout journey',
  baseUrl: 'https://api.test'
}

/**
 * The suite the builder produces for "measure this journey as smoke, load,
 * stress and soak": one canvas, one journey, four scenarios wired to it.
 */
function suiteWithScenarios(typeIds: ScenarioTypeId[]): Suite {
  const [first, ...rest] = sortScenarioTypeIds(typeIds)
  const seeded = seedFlow(first)
  let flow: Flow = {
    nodes: [
      ...seeded.nodes,
      {
        id: 'login',
        type: 'request',
        position: { x: 400, y: 0 },
        data: { request: createRequest({ name: 'Login', method: 'POST', url: 'https://api.test/login' }) }
      } as FlowNode,
      {
        id: 'cart',
        type: 'request',
        position: { x: 700, y: 0 },
        data: { request: createRequest({ name: 'Cart', url: 'https://api.test/cart' }) }
      } as FlowNode
    ],
    edges: [
      { id: 'e0', source: seeded.nodes[0].id, target: 'login' },
      { id: 'e1', source: 'login', target: 'cart' }
    ]
  }
  for (const typeId of rest) flow = addScenarioToFlow(flow, typeId).flow

  return {
    id: 'suite-1',
    name: 'Checkout Suite',
    description: 'One journey, several workloads.',
    execution: 'one-at-a-time',
    nodes: flow.nodes,
    edges: flow.edges,
    options: createGlobalOptions()
  }
}

describe('one journey measured by several scenarios', () => {
  const types: ScenarioTypeId[] = ['smoke', 'load', 'stress', 'soak']
  const suite = suiteWithScenarios(types)
  const build = buildSuite(META, suite)

  it('produces a single valid, exportable script', () => {
    expect(build.scriptError).toBeNull()
    expect(build.validation.errors).toEqual([])
    expect(build.validation.valid).toBe(true)
    expect(build.orphanNodeIds.size).toBe(0)
  })

  it('keeps every scenario in the same script, in campaign order', () => {
    expect(build.plan.scenarios.map((entry) => entry.scenario.typeId)).toEqual(types)
    for (const entry of build.plan.scenarios) {
      expect(entry.steps.map((step) => step.kind)).toEqual(['request', 'request'])
    }
  })

  it('gives each scenario its own executor and quality gates', () => {
    const executors = build.plan.scenarios.map((entry) => entry.scenario.executor.type)
    expect(executors).toEqual(['constant-vus', 'ramping-vus', 'ramping-vus', 'ramping-vus'])

    /* The soak holds its plateau for hours; smoke runs for a minute. */
    const [smoke, , , soak] = build.plan.scenarios.map((entry) => entry.scenario.executor)
    expect(smoke.duration).toBe('1m')
    expect(soak.stages.map((stage) => stage.duration)).toContain('4h')

    for (const entry of build.plan.scenarios) {
      expect(entry.scenario.thresholds.length).toBeGreaterThan(0)
    }
  })

  it('emits the shared journey once and scopes each scenario gate', () => {
    /* Four scenarios over one journey: one exported function, four entries. */
    expect(build.script.match(/export function /g)).toHaveLength(1)
    expect(build.script).toContain("exec: 'journey'")
    expect(build.script).toContain('${BASE_URL}/login')
    expect(build.script).toContain('${BASE_URL}/cart')

    for (const typeId of types) {
      expect(build.script).toContain(`http_req_failed{scenario:${typeId}}`)
    }
  })

  it('lets a single scenario be selected at run time', () => {
    expect(build.script).toContain("const requested = __ENV.SCENARIO || 'smoke'")
    for (const typeId of types) expect(build.script).toContain(`${typeId}: {`)
  })

  it('exports one artifact per suite, listing its scenarios', () => {
    const [artifact] = toArtifacts([build])
    expect(artifact.fileName).toBe('checkout-suite.js')
    expect(artifact.execution).toBe('one-at-a-time')
    expect(artifact.scenarios.map((scenario) => scenario.key)).toEqual(types)
    expect(artifact.scenarios.map((scenario) => scenario.typeId)).toEqual(types)
  })

  it('keeps scenarios isolated: editing one never changes another', () => {
    const edited = structuredClone(suite)
    const target = edited.nodes.find(
      (node) => node.type === 'scenario' && node.data.scenario.typeId === 'load'
    )
    if (target?.type !== 'scenario') throw new Error('expected the load scenario')
    target.data.scenario.executor.stages = [{ id: 's', duration: '9m', target: 999 }]
    target.data.scenario.thresholds = []

    const rebuilt = buildSuite(META, edited)
    const byType = new Map(rebuilt.plan.scenarios.map((entry) => [entry.scenario.typeId, entry.scenario]))
    expect(byType.get('load')?.executor.stages[0].target).toBe(999)
    expect(byType.get('stress')?.executor.stages[0].target).toBe(200)
    expect(byType.get('smoke')?.thresholds.length).toBeGreaterThan(0)
  })

  it('drops a disabled scenario from the script but keeps it in the suite', () => {
    const edited = structuredClone(suite)
    const target = edited.nodes.find(
      (node) => node.type === 'scenario' && node.data.scenario.typeId === 'soak'
    )
    if (target?.type !== 'scenario') throw new Error('expected the soak scenario')
    target.data.scenario.enabled = false

    const rebuilt = buildSuite(META, edited)
    expect(rebuilt.plan.scenarios).toHaveLength(4)
    expect(rebuilt.script).not.toContain('soak: {')
    expect(rebuilt.validation.valid).toBe(true)
    expect(toArtifacts([rebuilt])[0].scenarios.map((scenario) => scenario.key)).toEqual([
      'smoke',
      'load',
      'stress'
    ])
  })
})
