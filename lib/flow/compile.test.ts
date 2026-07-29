import { describe, expect, it } from 'vitest'
import { createGlobalOptions, createRequest, createScenario } from '@/lib/dsl/defaults'
import type { FlowEdge, FlowNode } from '@/lib/flow/types'
import { compileFlow } from './compile'

function scenarioNode(id: string, name: string): FlowNode {
  return {
    id,
    type: 'scenario',
    position: { x: 0, y: 0 },
    data: { scenario: { ...createScenario(name), id } }
  } as FlowNode
}
function requestNode(id: string, name: string): FlowNode {
  return {
    id,
    type: 'request',
    position: { x: 0, y: 0 },
    data: { request: createRequest({ name, url: 'https://api.example.com/x' }) }
  } as FlowNode
}
function edge(source: string, target: string): FlowEdge {
  return { id: `${source}-${target}`, source, target }
}

const meta = { name: 'T', description: '', baseUrl: '' }

describe('compileFlow', () => {
  it('includes a request shared by two scenarios in BOTH scenarios', () => {
    const nodes = [scenarioNode('sc1', 'a'), scenarioNode('sc2', 'b'), requestNode('r1', 'Shared')]
    const edges = [edge('sc1', 'r1'), edge('sc2', 'r1')]
    const { plan, orphanNodeIds } = compileFlow({ meta, options: createGlobalOptions(), nodes, edges })
    expect(plan.scenarios).toHaveLength(2)
    expect(plan.scenarios[0].steps).toHaveLength(1)
    expect(plan.scenarios[1].steps).toHaveLength(1)
    expect(orphanNodeIds).toHaveLength(0)
  })

  it('follows a linear chain in order', () => {
    const nodes = [scenarioNode('sc1', 'a'), requestNode('r1', 'One'), requestNode('r2', 'Two')]
    const edges = [edge('sc1', 'r1'), edge('r1', 'r2')]
    const { plan } = compileFlow({ meta, options: createGlobalOptions(), nodes, edges })
    expect(plan.scenarios[0].steps.map((s) => (s.kind === 'request' ? s.request.name : ''))).toEqual([
      'One',
      'Two'
    ])
  })

  it('does not infinite-loop on a cycle', () => {
    const nodes = [scenarioNode('sc1', 'a'), requestNode('r1', 'One'), requestNode('r2', 'Two')]
    const edges = [edge('sc1', 'r1'), edge('r1', 'r2'), edge('r2', 'r1')]
    const { plan } = compileFlow({ meta, options: createGlobalOptions(), nodes, edges })
    expect(plan.scenarios[0].steps.length).toBe(2)
  })

  it('emits unconnected group children instead of dropping them', () => {
    const group: FlowNode = {
      id: 'g1',
      type: 'group',
      position: { x: 0, y: 0 },
      data: { name: 'G' }
    } as FlowNode
    const child1 = { ...requestNode('c1', 'C1'), parentId: 'g1' } as FlowNode
    const child2 = { ...requestNode('c2', 'C2'), parentId: 'g1' } as FlowNode
    const nodes = [scenarioNode('sc1', 'a'), group, child1, child2]
    const edges = [edge('sc1', 'g1')]
    const { plan } = compileFlow({ meta, options: createGlobalOptions(), nodes, edges })
    const groupStep = plan.scenarios[0].steps.find((s) => s.kind === 'group')
    expect(groupStep?.kind).toBe('group')
    if (groupStep?.kind === 'group') expect(groupStep.children).toHaveLength(2)
  })
})
