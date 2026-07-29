import { describe, expect, it } from 'vitest'
import { createGlobalOptions, createRequest, createScenario, createThreshold } from '@/lib/dsl/defaults'
import type { ExecutorConfig } from '@/lib/dsl/types'
import { scenarioType } from '@/lib/k6/scenario-types'
import { addScenarioToFlow, cloneFlow, journeyHead, seedFlow, type Flow } from './clone'
import { compileFlow } from './compile'
import type { FlowEdge, FlowNode } from './types'

function node(id: string, type: FlowNode['type'], data: Record<string, unknown>): FlowNode {
  return { id, type, position: { x: 0, y: 0 }, data } as FlowNode
}

function edge(source: string, target: string, sourceHandle?: string): FlowEdge {
  return { id: `${source}-${target}`, source, target, ...(sourceHandle !== undefined && { sourceHandle }) }
}

/** Stage ids are generated per call, so compare the load shape that matters. */
function loadShape(executor: ExecutorConfig): Record<string, unknown> {
  return {
    type: executor.type,
    vus: executor.vus,
    duration: executor.duration,
    startVUs: executor.startVUs,
    startRate: executor.startRate,
    preAllocatedVUs: executor.preAllocatedVUs,
    maxVUs: executor.maxVUs,
    stages: executor.stages.map((stage) => ({ duration: stage.duration, target: stage.target }))
  }
}

/** A journey with a scenario, two requests, a think time and a group child. */
function journey(): Flow {
  const scenario = createScenario('checkout')
  return {
    nodes: [
      node('scenario-1', 'scenario', { scenario }),
      node('login', 'request', { request: createRequest({ name: 'Login', url: 'https://api.test/login' }) }),
      node('think', 'think-time', { minSeconds: 1, maxSeconds: 3 }),
      node('group-1', 'group', { name: 'Account' }),
      {
        ...node('me', 'request', { request: createRequest({ name: 'Me' }) }),
        parentId: 'group-1'
      } as FlowNode,
      node('env-1', 'env-var', {
        envVar: { id: 'e1', name: 'TOKEN', defaultValue: '', required: true, description: '' }
      }),
      node('suite-threshold', 'threshold', { threshold: createThreshold('checks') })
    ],
    edges: [edge('scenario-1', 'login'), edge('login', 'think'), edge('think', 'group-1')]
  }
}

const META = { name: 'p', description: '', baseUrl: '' }

function compileOf(flow: Flow): ReturnType<typeof compileFlow> {
  return compileFlow({ meta: META, options: createGlobalOptions(), nodes: flow.nodes, edges: flow.edges })
}

describe('cloneFlow', () => {
  it('gives every node and edge a fresh id while preserving the wiring', () => {
    const source = journey()
    const clone = cloneFlow(source.nodes, source.edges)

    expect(clone.nodes).toHaveLength(source.nodes.length)
    expect(clone.edges).toHaveLength(source.edges.length)

    const sourceIds = new Set(source.nodes.map((entry) => entry.id))
    for (const cloned of clone.nodes) expect(sourceIds.has(cloned.id)).toBe(false)

    /* The chain still starts at the scenario and reaches the group. */
    const scenarioNode = clone.nodes.find((entry) => entry.type === 'scenario')
    const groupNode = clone.nodes.find((entry) => entry.type === 'group')
    expect(clone.edges.some((entry) => entry.source === scenarioNode?.id)).toBe(true)
    expect(clone.edges.some((entry) => entry.target === groupNode?.id)).toBe(true)
  })

  it('remaps parentId so group children stay inside their clone', () => {
    const source = journey()
    const clone = cloneFlow(source.nodes, source.edges)
    const group = clone.nodes.find((entry) => entry.type === 'group')
    const child = clone.nodes.find((entry) => entry.parentId !== undefined)

    expect(child?.parentId).toBe(group?.id)
  })

  it('deep-clones data so edits cannot leak back into the source', () => {
    const source = journey()
    const clone = cloneFlow(source.nodes, source.edges)
    const clonedRequest = clone.nodes.find((entry) => entry.type === 'request')

    if (clonedRequest?.type !== 'request') throw new Error('expected a request node')
    clonedRequest.data.request.url = 'https://changed.test'

    const sourceRequest = source.nodes.find((entry) => entry.id === 'login')
    if (sourceRequest?.type !== 'request') throw new Error('expected a request node')
    expect(sourceRequest.data.request.url).toBe('https://api.test/login')
  })

  it('drops edges pointing outside the cloned selection', () => {
    const clone = cloneFlow([node('a', 'sleep', { seconds: 1 })], [edge('a', 'missing')])
    expect(clone.edges).toHaveLength(0)
  })
})

describe('seedFlow', () => {
  it('seeds one scenario carrying its type template and quality gates', () => {
    const flow = seedFlow('stress')
    const scenario = flow.nodes.find((entry) => entry.type === 'scenario')

    if (scenario?.type !== 'scenario') throw new Error('expected a scenario node')
    expect(flow.nodes).toHaveLength(1)
    expect(scenario.data.scenario.typeId).toBe('stress')
    expect(scenario.data.scenario.enabled).toBe(true)
    expect(loadShape(scenario.data.scenario.executor)).toEqual(
      loadShape(scenarioType('stress').buildExecutor())
    )
    /* Gates belong to the scenario, so they can never bleed into another one. */
    expect(scenario.data.scenario.thresholds).toHaveLength(scenarioType('stress').buildThresholds().length)
  })
})

describe('journeyHead', () => {
  it('finds the first step, ignoring scenario entry points', () => {
    const source = journey()
    expect(journeyHead(source.nodes, source.edges)?.id).toBe('login')
  })

  it('is undefined when the canvas has no steps yet', () => {
    const flow = seedFlow('smoke')
    expect(journeyHead(flow.nodes, flow.edges)).toBeUndefined()
  })
})

describe('addScenarioToFlow', () => {
  it('wires a new scenario to the journey that is already on the canvas', () => {
    const source = journey()
    const { flow, scenarioId } = addScenarioToFlow(source, 'soak')

    const added = flow.nodes.find((entry) => entry.id === scenarioId)
    if (added?.type !== 'scenario') throw new Error('expected a scenario node')
    expect(added.data.scenario.typeId).toBe('soak')
    expect(loadShape(added.data.scenario.executor)).toEqual(loadShape(scenarioType('soak').buildExecutor()))

    /* Both scenarios now enter the same first step — nothing was duplicated. */
    expect(flow.edges.some((entry) => entry.source === scenarioId && entry.target === 'login')).toBe(true)
    expect(flow.nodes.filter((entry) => entry.type === 'request')).toHaveLength(2)

    const { plan } = compileOf(flow)
    expect(plan.scenarios).toHaveLength(2)
    expect(plan.scenarios[0].steps.map((step) => step.kind)).toEqual(
      plan.scenarios[1].steps.map((step) => step.kind)
    )
  })

  it('gives each scenario its own executor and gates', () => {
    const seeded = seedFlow('smoke')
    const withJourney: Flow = {
      nodes: [...seeded.nodes, node('login', 'request', { request: createRequest() })],
      edges: [edge(seeded.nodes[0].id, 'login')]
    }
    const { flow } = addScenarioToFlow(withJourney, 'breakpoint')

    const { plan } = compileOf(flow)
    expect(plan.scenarios.map((entry) => entry.scenario.executor.type)).toEqual([
      'constant-vus',
      'ramping-arrival-rate'
    ])
    /* Editing one scenario's gates cannot touch the other's. */
    plan.scenarios[0].scenario.thresholds[0].value = '1'
    expect(plan.scenarios[1].scenario.thresholds[0].value).not.toBe('1')
  })

  it('leaves the new scenario unwired when the journey is not reused', () => {
    const { flow, scenarioId } = addScenarioToFlow(journey(), 'spike', { reuseJourney: false })
    expect(flow.edges.some((entry) => entry.source === scenarioId)).toBe(false)

    const { plan } = compileOf(flow)
    expect(plan.scenarios).toHaveLength(2)
    expect(plan.scenarios.find((entry) => entry.scenario.id === scenarioId)?.steps).toEqual([])
  })

  it('does not overlap the lane of an existing scenario', () => {
    const first = seedFlow('smoke')
    const { flow, scenarioId } = addScenarioToFlow(first, 'load')
    const added = flow.nodes.find((entry) => entry.id === scenarioId)
    expect(added?.position.y).toBeGreaterThan(first.nodes[0].position.y)
  })
})
