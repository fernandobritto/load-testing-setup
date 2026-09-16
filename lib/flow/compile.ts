import type { GlobalOptions, ScenarioExecutionMode, Step, TestPlan } from '@/lib/dsl/types'
import type { FlowEdge, FlowNode } from './types'

export interface CompileInput {
  meta: { name: string; description: string; baseUrl: string }
  options: GlobalOptions
  /** Whether the suite's scenarios are alternatives or one combined workload. */
  execution?: ScenarioExecutionMode
  nodes: FlowNode[]
  edges: FlowEdge[]
}

export interface CompileResult {
  plan: TestPlan
  /** Chain nodes not reachable from any scenario / setup / teardown entry */
  orphanNodeIds: string[]
}

/**
 * Compiles the React Flow graph into the internal TestPlan DSL.
 *
 * Semantics:
 * - Every `scenario` node is an entry point; the default edge chain after it
 *   becomes the scenario's steps.
 * - `group` nodes are containers: their children (nodes with parentId) form
 *   the group body, ordered by the edges between them.
 * - `conditional` nodes fork the chain via their `true` / `false` handles;
 *   branches are terminal sub-chains.
 * - `loop` nodes run their `body` chain N times, then continue via `next`.
 * - Config nodes (threshold, metric, env-var, shared-data) contribute to the
 *   plan globally regardless of position.
 */
export function compileFlow(input: CompileInput): CompileResult {
  const { nodes, edges } = input
  const nodeById = new Map<string, FlowNode>(nodes.map((node) => [node.id, node]))
  /* Every node emitted anywhere — drives orphan detection. A node may legitimately
     appear in more than one scenario, so this is separate from the per-entry cycle
     guard passed down as `seen`. */
  const reached = new Set<string>()

  const nextNodeId = (nodeId: string, handle?: string): string | null => {
    const edge = edges.find(
      (e) =>
        e.source === nodeId && (handle === undefined ? e.sourceHandle == null : e.sourceHandle === handle)
    )
    if (edge === undefined) return null
    return edge.target
  }

  const chainToSteps = (startId: string | null, seen: Set<string>): Step[] => {
    const steps: Step[] = []
    let currentId = startId
    while (currentId !== null) {
      if (seen.has(currentId)) break // cycle guard, scoped to this entry point
      const node = nodeById.get(currentId)
      if (node === undefined) break
      seen.add(currentId)
      reached.add(currentId)

      const step = nodeToStep(node, seen)
      if (step !== null) steps.push(step)

      currentId = nextNodeId(currentId, node.type === 'loop' ? 'next' : undefined)
    }
    return steps
  }

  const groupChildrenSteps = (groupId: string, seen: Set<string>): Step[] => {
    const children = nodes.filter((node) => node.parentId === groupId)
    if (children.length === 0) return []
    const childIds = new Set(children.map((c) => c.id))
    const hasIncoming = (nodeId: string): boolean =>
      edges.some((e) => e.target === nodeId && childIds.has(e.source))
    const start = children.find((c) => !hasIncoming(c.id)) ?? children[0]
    const steps = chainToSteps(start.id, seen)
    /* Append any children not wired into the chain so nothing silently vanishes. */
    for (const child of children) {
      if (!seen.has(child.id)) steps.push(...chainToSteps(child.id, seen))
    }
    return steps
  }

  const nodeToStep = (node: FlowNode, seen: Set<string>): Step | null => {
    switch (node.type) {
      case 'request':
        return { kind: 'request', id: node.id, request: node.data.request }
      case 'batch':
        return { kind: 'batch', id: node.id, name: node.data.name, requests: node.data.requests }
      case 'group':
        return {
          kind: 'group',
          id: node.id,
          name: node.data.name,
          children: groupChildrenSteps(node.id, seen)
        }
      case 'sleep':
        return { kind: 'sleep', id: node.id, seconds: node.data.seconds }
      case 'think-time':
        return {
          kind: 'think-time',
          id: node.id,
          minSeconds: node.data.minSeconds,
          maxSeconds: node.data.maxSeconds
        }
      case 'conditional':
        return {
          kind: 'conditional',
          id: node.id,
          condition: node.data.condition,
          whenTrue: chainToSteps(nextNodeId(node.id, 'true'), seen),
          whenFalse: chainToSteps(nextNodeId(node.id, 'false'), seen)
        }
      case 'loop':
        return {
          kind: 'loop',
          id: node.id,
          iterations: node.data.iterations,
          children: chainToSteps(nextNodeId(node.id, 'body'), seen)
        }
      default:
        return null
    }
  }

  /* Entry points — each gets a fresh cycle guard so a step shared between two
     scenarios is included in both. */
  const scenarios = nodes
    .filter((node): node is Extract<FlowNode, { type: 'scenario' }> => node.type === 'scenario')
    .map((node) => {
      reached.add(node.id)
      return {
        scenario: { ...node.data.scenario, id: node.id },
        steps: chainToSteps(nextNodeId(node.id), new Set([node.id]))
      }
    })

  const setupNode = nodes.find((node) => node.type === 'setup')
  const teardownNode = nodes.find((node) => node.type === 'teardown')
  let setupSteps: Step[] = []
  let teardownSteps: Step[] = []
  if (setupNode !== undefined) {
    reached.add(setupNode.id)
    setupSteps = chainToSteps(nextNodeId(setupNode.id), new Set([setupNode.id]))
  }
  if (teardownNode !== undefined) {
    reached.add(teardownNode.id)
    teardownSteps = chainToSteps(nextNodeId(teardownNode.id), new Set([teardownNode.id]))
  }

  /* Config nodes */
  const thresholds = nodes
    .filter((node): node is Extract<FlowNode, { type: 'threshold' }> => node.type === 'threshold')
    .map((node) => ({ ...node.data.threshold, id: node.id }))
  const customMetrics = nodes
    .filter((node): node is Extract<FlowNode, { type: 'metric' }> => node.type === 'metric')
    .map((node) => ({ ...node.data.metric, id: node.id }))
  const envVars = nodes
    .filter((node): node is Extract<FlowNode, { type: 'env-var' }> => node.type === 'env-var')
    .map((node) => ({ ...node.data.envVar, id: node.id }))
  const sharedData = nodes
    .filter((node): node is Extract<FlowNode, { type: 'shared-data' }> => node.type === 'shared-data')
    .map((node) => ({ ...node.data.sharedData, id: node.id }))

  /* Orphans: chain nodes never reached (children of groups count via chain) */
  const orphanNodeIds = nodes
    .filter(
      (node) =>
        !reached.has(node.id) &&
        node.type !== 'threshold' &&
        node.type !== 'metric' &&
        node.type !== 'env-var' &&
        node.type !== 'shared-data'
    )
    .map((node) => node.id)

  const plan: TestPlan = {
    meta: input.meta,
    options: input.options,
    execution: input.execution ?? 'one-at-a-time',
    scenarios,
    thresholds,
    customMetrics,
    envVars,
    sharedData,
    hasSetup: setupNode !== undefined,
    setupSteps,
    hasTeardown: teardownNode !== undefined,
    teardownSteps
  }

  return { plan, orphanNodeIds }
}
