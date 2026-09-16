import { buildScenario, type ScenarioTypeId } from '@/lib/k6/scenario-types'
import { uid } from '@/lib/utils'
import { isChainNode, type FlowEdge, type FlowNode } from './types'

/** A canvas: the nodes and edges of one suite. */
export interface Flow {
  nodes: FlowNode[]
  edges: FlowEdge[]
}

/** Where the first scenario lane sits, and how far apart stacked lanes are. */
export const SCENARIO_ORIGIN = { x: 96, y: 200 }
export const SCENARIO_LANE_HEIGHT = 140
/** Horizontal gap when a scenario node has to be placed before an existing chain. */
const SCENARIO_GAP = 320

/** Deep-clones a canvas, giving every node and edge a fresh id. */
export function cloneFlow(nodes: FlowNode[], edges: FlowEdge[]): Flow {
  const idMap = new Map<string, string>()
  for (const node of nodes) idMap.set(node.id, uid())

  const clonedNodes = nodes.map((node) => {
    const clone = structuredClone(node)
    clone.id = idMap.get(node.id) ?? uid()
    clone.selected = false
    if (clone.parentId !== undefined) {
      const mappedParent = idMap.get(clone.parentId)
      if (mappedParent !== undefined) clone.parentId = mappedParent
      else delete clone.parentId
    }
    return clone
  })

  const clonedEdges = edges
    .filter((edge) => idMap.has(edge.source) && idMap.has(edge.target))
    .map((edge) => ({
      ...structuredClone(edge),
      id: uid(),
      source: idMap.get(edge.source) ?? edge.source,
      target: idMap.get(edge.target) ?? edge.target
    }))

  return { nodes: clonedNodes, edges: clonedEdges }
}

/** A canvas node carrying a scenario configured from its type template. */
export function scenarioNodeFor(typeId: ScenarioTypeId, position = SCENARIO_ORIGIN, name?: string): FlowNode {
  return {
    id: uid(),
    type: 'scenario',
    position: { ...position },
    data: { scenario: buildScenario(typeId, name) }
  } as FlowNode
}

/** A fresh canvas holding a single scenario, ready for a journey to be wired in. */
export function seedFlow(typeId: ScenarioTypeId): Flow {
  return { nodes: [scenarioNodeFor(typeId)], edges: [] }
}

/** Step nodes that can start a journey — top-level, not entry points themselves. */
function journeySteps(nodes: FlowNode[]): FlowNode[] {
  return nodes.filter(
    (node) =>
      node.parentId === undefined &&
      isChainNode(node) &&
      node.type !== 'scenario' &&
      node.type !== 'setup' &&
      node.type !== 'teardown'
  )
}

/**
 * First step nothing in the journey points at — the head every scenario should
 * be wired to. Steps fed only by scenario nodes still count as heads, which is
 * what lets several scenarios share one journey.
 */
export function journeyHead(nodes: FlowNode[], edges: FlowEdge[]): FlowNode | undefined {
  const stepIds = new Set(journeySteps(nodes).map((node) => node.id))
  return journeySteps(nodes).find(
    (node) => !edges.some((edge) => edge.target === node.id && stepIds.has(edge.source))
  )
}

/** Where to place the next scenario lane so lanes never overlap. */
export function nextScenarioPosition(nodes: FlowNode[]): { x: number; y: number } {
  const lanes = nodes.filter((node) => node.type === 'scenario')
  if (lanes.length === 0) return { ...SCENARIO_ORIGIN }
  const lowest = Math.max(...lanes.map((node) => node.position.y))
  const leftmost = Math.min(...lanes.map((node) => node.position.x))
  return { x: leftmost, y: lowest + SCENARIO_LANE_HEIGHT }
}

/**
 * Adds a scenario to a canvas and wires it to the journey that is already
 * there, so a new test type costs one click instead of a rebuild. Several
 * scenarios pointing at the same head is exactly the shape k6 documents for
 * sharing one `exec` function between scenarios.
 */
export function addScenarioToFlow(
  flow: Flow,
  typeId: ScenarioTypeId,
  options: { reuseJourney?: boolean; name?: string } = {}
): { flow: Flow; scenarioId: string } {
  const head = options.reuseJourney === false ? undefined : journeyHead(flow.nodes, flow.edges)
  const position = nextScenarioPosition(flow.nodes)
  const node = scenarioNodeFor(
    typeId,
    head === undefined
      ? position
      : { x: Math.min(position.x, head.position.x - SCENARIO_GAP), y: position.y },
    options.name
  )

  return {
    scenarioId: node.id,
    flow: {
      nodes: [...flow.nodes, node],
      edges:
        head === undefined
          ? flow.edges
          : [...flow.edges, { id: uid(), source: node.id, target: head.id, animated: true }]
    }
  }
}
