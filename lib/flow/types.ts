import type { Edge, Node } from '@xyflow/react'
import type {
  CustomMetricDef,
  EnvVarDef,
  HttpRequestDef,
  ScenarioDef,
  SharedDataDef,
  ThresholdDef
} from '@/lib/dsl/types'

/** Data payloads per canvas node type */
export interface ScenarioNodeData {
  scenario: ScenarioDef
  [key: string]: unknown
}
export interface RequestNodeData {
  request: HttpRequestDef
  [key: string]: unknown
}
export interface BatchNodeData {
  name: string
  requests: HttpRequestDef[]
  [key: string]: unknown
}
export interface GroupNodeData {
  name: string
  [key: string]: unknown
}
export interface SleepNodeData {
  seconds: number
  [key: string]: unknown
}
export interface ThinkTimeNodeData {
  minSeconds: number
  maxSeconds: number
  [key: string]: unknown
}
export interface ConditionalNodeData {
  condition: string
  [key: string]: unknown
}
export interface LoopNodeData {
  iterations: number
  [key: string]: unknown
}
export interface ThresholdNodeData {
  threshold: ThresholdDef
  [key: string]: unknown
}
export interface MetricNodeData {
  metric: CustomMetricDef
  [key: string]: unknown
}
export interface EnvVarNodeData {
  envVar: EnvVarDef
  [key: string]: unknown
}
export interface SharedDataNodeData {
  sharedData: SharedDataDef
  [key: string]: unknown
}
export interface LifecycleNodeData {
  [key: string]: unknown
}

export type FlowNode =
  | Node<ScenarioNodeData, 'scenario'>
  | Node<RequestNodeData, 'request'>
  | Node<BatchNodeData, 'batch'>
  | Node<GroupNodeData, 'group'>
  | Node<SleepNodeData, 'sleep'>
  | Node<ThinkTimeNodeData, 'think-time'>
  | Node<ConditionalNodeData, 'conditional'>
  | Node<LoopNodeData, 'loop'>
  | Node<ThresholdNodeData, 'threshold'>
  | Node<MetricNodeData, 'metric'>
  | Node<EnvVarNodeData, 'env-var'>
  | Node<SharedDataNodeData, 'shared-data'>
  | Node<LifecycleNodeData, 'setup'>
  | Node<LifecycleNodeData, 'teardown'>

export type FlowNodeType = NonNullable<FlowNode['type']>
export type FlowEdge = Edge

/** Node types that take part in the execution chain (have flow handles) */
export const CHAIN_NODE_TYPES: FlowNodeType[] = [
  'scenario',
  'request',
  'batch',
  'group',
  'sleep',
  'think-time',
  'conditional',
  'loop',
  'setup',
  'teardown'
]

/** Node types that configure the test globally (no flow handles) */
export const CONFIG_NODE_TYPES: FlowNodeType[] = ['threshold', 'metric', 'env-var', 'shared-data']

export function isChainNode(node: FlowNode): boolean {
  return CHAIN_NODE_TYPES.includes(node.type as FlowNodeType)
}
