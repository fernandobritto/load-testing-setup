import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange
} from '@xyflow/react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { parseCurlCommands, type CurlParseError } from '@/lib/curl/parse'
import {
  createCustomMetric,
  createEnvVar,
  createGlobalOptions,
  createRequest,
  createScenario,
  createSharedData,
  createThreshold
} from '@/lib/dsl/defaults'
import type {
  GlobalOptions,
  HttpRequestDef,
  ScenarioDef,
  ScenarioExecutionMode,
  ThresholdDef
} from '@/lib/dsl/types'
import { addScenarioToFlow, cloneFlow, nextScenarioPosition, seedFlow } from '@/lib/flow/clone'
import type { FlowEdge, FlowNode, FlowNodeType } from '@/lib/flow/types'
import { buildScenario, sortScenarioTypeIds, type ScenarioTypeId } from '@/lib/k6/scenario-types'
import { uid } from '@/lib/utils'

export type WizardStep = 1 | 2 | 3

/**
 * A test suite is one k6 script: a journey drawn on a canvas plus the set of
 * **scenarios** that measure it. A scenario is a workload — smoke, load, spike,
 * soak, a custom benchmark — with its own executor, ramp, quality gates, tags
 * and environment, and scenarios never affect one another.
 *
 * Most projects need a single suite holding several scenarios. Add another suite
 * when the *journey* differs (checkout API vs. search API), not when the load
 * shape does.
 */
export interface Suite {
  id: string
  name: string
  description: string
  /** Whether this suite's scenarios are alternatives or one combined workload. */
  execution: ScenarioExecutionMode
  nodes: FlowNode[]
  edges: FlowEdge[]
  options: GlobalOptions
}

/** Adding a scenario: reuse the journey already on the canvas, or start empty. */
export interface AddScenarioOptions {
  /** Wire the new scenario to the existing journey (default true). */
  reuseJourney?: boolean
}

interface HistorySnapshot {
  suiteId: string
  nodes: FlowNode[]
  edges: FlowEdge[]
}

interface Clipboard {
  nodes: FlowNode[]
  edges: FlowEdge[]
}

export interface ProjectMeta {
  name: string
  description: string
  baseUrl: string
}

export interface ProjectExport {
  version: 3
  kind: 'k6-studio-project'
  meta: ProjectMeta
  requests: HttpRequestDef[]
  requestGroups: Record<string, string>
  suites: Suite[]
}

export interface SuiteExport {
  version: 3
  kind: 'k6-studio-suite'
  suite: Suite
  requests: HttpRequestDef[]
}

interface ProjectState {
  meta: ProjectMeta
  step: WizardStep
  curlText: string
  curlErrors: CurlParseError[]
  requests: HttpRequestDef[]
  requestGroups: Record<string, string>
  suites: Suite[]
  activeSuiteId: string
  past: HistorySnapshot[]
  future: HistorySnapshot[]
  clipboard: Clipboard | null

  setMeta: (meta: Partial<ProjectMeta>) => void
  setStep: (step: WizardStep) => void
  setCurlText: (text: string) => void
  importCurl: () => number
  addBlankRequest: () => void
  updateRequest: (id: string, patch: Partial<HttpRequestDef>) => void
  removeRequest: (id: string) => void
  duplicateRequest: (id: string) => void
  moveRequest: (fromIndex: number, toIndex: number) => void
  setRequestGroup: (id: string, group: string) => void

  setOptions: (patch: Partial<GlobalOptions>) => void

  /* Suite management */
  addSuite: (name?: string) => string
  duplicateSuite: (id: string) => void
  renameSuite: (id: string, name: string, description?: string) => void
  removeSuite: (id: string) => void
  reorderSuites: (fromIndex: number, toIndex: number) => void
  setActiveSuite: (id: string) => void
  setSuiteExecution: (mode: ScenarioExecutionMode) => void
  importSuite: (data: SuiteExport) => void

  /* Scenario management (within the active suite) */
  addScenario: (typeId: ScenarioTypeId, options?: AddScenarioOptions) => string
  addScenarios: (typeIds: ScenarioTypeId[], options?: AddScenarioOptions) => string[]
  updateScenario: (nodeId: string, patch: Partial<ScenarioDef>) => void
  setScenarioThresholds: (nodeId: string, thresholds: ThresholdDef[]) => void
  toggleScenario: (nodeId: string, enabled: boolean) => void
  duplicateScenario: (nodeId: string) => string | null
  removeScenario: (nodeId: string) => void
  reorderScenarios: (fromIndex: number, toIndex: number) => void
  selectScenario: (nodeId: string) => void

  onNodesChange: (changes: NodeChange<FlowNode>[]) => void
  onEdgesChange: (changes: EdgeChange<FlowEdge>[]) => void
  onConnect: (connection: Connection) => void
  addNode: (type: FlowNodeType, position: { x: number; y: number }, requestId?: string) => string
  updateNodeData: (id: string, patch: Record<string, unknown>) => void
  removeNodes: (ids: string[]) => void
  copySelection: () => void
  paste: () => void
  duplicateSelection: () => void
  autoLayout: () => void

  pushHistory: () => void
  undo: () => void
  redo: () => void

  exportProject: () => ProjectExport
  exportSuite: (id: string) => SuiteExport
  importProject: (data: ProjectExport) => void
  resetProject: () => void
}

const MAX_HISTORY = 50

const CHAIN_TYPES = new Set<FlowNodeType>([
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
])

/* ------------------------------------------------------------------ */
/* Selectors — components read the active suite through these so that   */
/* `nodes`/`edges`/`options` keep stable references across renders.     */
/* ------------------------------------------------------------------ */

export function selectActiveSuite(state: ProjectState): Suite {
  return state.suites.find((suite) => suite.id === state.activeSuiteId) ?? state.suites[0]
}
export const selectNodes = (state: ProjectState): FlowNode[] => selectActiveSuite(state).nodes
export const selectEdges = (state: ProjectState): FlowEdge[] => selectActiveSuite(state).edges
export const selectOptions = (state: ProjectState): GlobalOptions => selectActiveSuite(state).options

/** Scenario node of a canvas — a scenario is always backed by one node. */
export type ScenarioNode = Extract<FlowNode, { type: 'scenario' }>

/**
 * The scenarios of a canvas, in node order (which is the order they are emitted
 * in `options.scenarios`).
 *
 * Deliberately *not* a store selector: it allocates a new array, and a selector
 * that never returns a stable reference re-renders on every snapshot check.
 * Components call it inside a `useMemo` keyed on the nodes array instead.
 */
export function scenarioNodesOf(nodes: FlowNode[]): ScenarioNode[] {
  return nodes.filter((node): node is ScenarioNode => node.type === 'scenario')
}

/* ------------------------------------------------------------------ */
/* Factories                                                           */
/* ------------------------------------------------------------------ */

export function createSuite(name: string, description = ''): Suite {
  return {
    id: uid(),
    name,
    description,
    execution: 'one-at-a-time',
    nodes: [],
    edges: [],
    options: createGlobalOptions()
  }
}

const NODE_DIMENSIONS: Partial<Record<FlowNodeType, { width: number; height: number }>> = {
  group: { width: 440, height: 280 }
}

export function createNodePayload(type: FlowNodeType, request?: HttpRequestDef): FlowNode['data'] {
  switch (type) {
    case 'scenario':
      return { scenario: buildScenario('custom', 'scenario') }
    case 'request':
      return { request: request !== undefined ? structuredClone({ ...request, id: uid() }) : createRequest() }
    case 'batch':
      return { name: 'Parallel Batch', requests: [] }
    case 'group':
      return { name: 'Group' }
    case 'sleep':
      return { seconds: 1 }
    case 'think-time':
      return { minSeconds: 1, maxSeconds: 4 }
    case 'conditional':
      return { condition: '' }
    case 'loop':
      return { iterations: 3 }
    case 'threshold':
      return { threshold: createThreshold() }
    case 'metric':
      return { metric: createCustomMetric() }
    case 'env-var':
      return { envVar: createEnvVar() }
    case 'shared-data':
      return { sharedData: createSharedData() }
    case 'setup':
    case 'teardown':
      return {}
  }
}

/** Keeps names distinguishable: "Load Test", "Load Test 2", … */
function uniqueName(taken: Iterable<string>, label: string, separator = ' '): string {
  const used = new Set(taken)
  if (!used.has(label)) return label
  let counter = 2
  while (used.has(`${label}${separator}${counter}`)) counter += 1
  return `${label}${separator}${counter}`
}

function uniqueSuiteName(suites: Suite[], label: string): string {
  return uniqueName(
    suites.map((suite) => suite.name),
    label
  )
}

/**
 * Scenario names identify the workload in k6 results and become the key in
 * `options.scenarios`, so they must stay unique inside a suite.
 */
function uniqueScenarioName(nodes: FlowNode[], label: string): string {
  return uniqueName(
    scenarioNodesOf(nodes).map((node) => node.data.scenario.name),
    label,
    '-'
  )
}

/* ------------------------------------------------------------------ */
/* Initial state                                                       */
/* ------------------------------------------------------------------ */

type PersistedState = Pick<
  ProjectState,
  'meta' | 'step' | 'curlText' | 'requests' | 'requestGroups' | 'suites' | 'activeSuiteId'
>

function initialState(): PersistedState & Pick<ProjectState, 'curlErrors' | 'past' | 'future' | 'clipboard'> {
  /* A new project starts as a suite with the one scenario every project needs:
     a smoke test. More workloads are added from the Scenarios panel. */
  const flow = seedFlow('smoke')
  const suite: Suite = {
    ...createSuite('Performance Suite', 'Scenarios measuring one user journey.'),
    nodes: flow.nodes,
    edges: flow.edges
  }
  return {
    meta: { name: '', description: '', baseUrl: '' },
    step: 1,
    curlText: '',
    curlErrors: [],
    requests: [],
    requestGroups: {},
    suites: [suite],
    activeSuiteId: '',
    past: [],
    future: [],
    clipboard: null
  }
}

/* ------------------------------------------------------------------ */
/* Migration: one test type per suite → many scenarios per suite        */
/* ------------------------------------------------------------------ */

/** A suite as persisted by v1/v2, where the test type was a property of the suite. */
type LegacySuite = Omit<Suite, 'execution'> & {
  execution?: ScenarioExecutionMode
  presetHint?: ScenarioTypeId | null
}

/**
 * Brings a persisted suite up to the scenario model.
 *
 * v2 stored the test type on the suite (`presetHint`) and its quality gates as
 * canvas nodes flagged `fromPreset`. Both now belong to the scenario, so the
 * type moves onto every scenario of the suite and the preset gates become the
 * first scenario's own thresholds. Hand-added threshold nodes stay on the canvas
 * as suite-wide gates, which is what they always were.
 */
function migrateSuiteToScenarios(suite: LegacySuite): Suite {
  const typeId: ScenarioTypeId = suite.presetHint ?? 'custom'
  const presetThresholds: ThresholdDef[] = suite.nodes
    .filter((node) => node.type === 'threshold' && node.data.fromPreset === true)
    .map((node) => (node.data as { threshold: ThresholdDef }).threshold)

  let firstScenario = true
  const nodes = suite.nodes
    .filter((node) => !(node.type === 'threshold' && node.data.fromPreset === true))
    .map((node) => {
      if (node.type !== 'scenario') return node
      const legacy = node.data.scenario as Partial<ScenarioDef> & { name: string }
      const scenario: ScenarioDef = {
        ...createScenario(legacy.name),
        ...legacy,
        typeId: legacy.typeId ?? typeId,
        description: legacy.description ?? '',
        enabled: legacy.enabled ?? true,
        thresholds: legacy.thresholds ?? (firstScenario ? presetThresholds : [])
      }
      firstScenario = false
      return { ...node, data: { ...node.data, scenario } } as FlowNode
    })

  const keptIds = new Set(nodes.map((node) => node.id))
  return {
    id: suite.id,
    name: suite.name,
    description: suite.description,
    execution: suite.execution ?? 'one-at-a-time',
    nodes,
    edges: suite.edges.filter((edge) => keptIds.has(edge.source) && keptIds.has(edge.target)),
    options: suite.options ?? createGlobalOptions()
  }
}

function snapshot(suite: Suite): HistorySnapshot {
  return { suiteId: suite.id, nodes: structuredClone(suite.nodes), edges: structuredClone(suite.edges) }
}

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => {
      /** Applies a patch to the active suite. */
      const patchActive = (updater: (suite: Suite) => Partial<Suite>): void => {
        set((state) => ({
          suites: state.suites.map((suite) =>
            suite.id === state.activeSuiteId ? { ...suite, ...updater(suite) } : suite
          )
        }))
      }

      return {
        ...initialState(),
        activeSuiteId: '',

        setMeta: (meta) => set((state) => ({ meta: { ...state.meta, ...meta } })),
        setStep: (step) => set({ step }),
        setCurlText: (curlText) => set({ curlText }),

        importCurl: () => {
          const { curlText, requests } = get()
          const result = parseCurlCommands(curlText)
          set({
            curlErrors: result.errors,
            requests: result.requests.length > 0 ? [...requests, ...result.requests] : requests,
            curlText: result.errors.length === 0 && result.requests.length > 0 ? '' : curlText
          })
          return result.requests.length
        },

        addBlankRequest: () => set((state) => ({ requests: [...state.requests, createRequest()] })),

        updateRequest: (requestId, patch) =>
          set((state) => ({
            requests: state.requests.map((request) =>
              request.id === requestId ? { ...request, ...patch } : request
            )
          })),

        removeRequest: (requestId) =>
          set((state) => {
            const requestGroups = { ...state.requestGroups }
            delete requestGroups[requestId]
            return { requests: state.requests.filter((request) => request.id !== requestId), requestGroups }
          }),

        duplicateRequest: (requestId) =>
          set((state) => {
            const source = state.requests.find((request) => request.id === requestId)
            if (source === undefined) return state
            const copy = structuredClone(source)
            copy.id = uid()
            copy.name = `${copy.name} (copy)`
            const sourceIndex = state.requests.findIndex((request) => request.id === requestId)
            const requests = [...state.requests]
            requests.splice(sourceIndex + 1, 0, copy)
            return { ...state, requests }
          }),

        moveRequest: (fromIndex, toIndex) =>
          set((state) => {
            const count = state.requests.length
            if (fromIndex < 0 || fromIndex >= count || toIndex < 0 || toIndex >= count) return state
            const requests = [...state.requests]
            const [moved] = requests.splice(fromIndex, 1)
            requests.splice(toIndex, 0, moved)
            return { requests }
          }),

        setRequestGroup: (requestId, group) =>
          set((state) => ({ requestGroups: { ...state.requestGroups, [requestId]: group } })),

        setOptions: (patch) => patchActive((suite) => ({ options: { ...suite.options, ...patch } })),

        /* ---------------- Suite management ---------------- */

        /** Adds an empty suite — a second script, for a different journey. */
        addSuite: (name) => {
          const state = get()
          const suite = createSuite(uniqueSuiteName(state.suites, name ?? `Suite ${state.suites.length + 1}`))
          set((current) => ({
            suites: [...current.suites, suite],
            activeSuiteId: suite.id,
            past: [],
            future: []
          }))
          return suite.id
        },

        duplicateSuite: (id) =>
          set((state) => {
            const source = state.suites.find((suite) => suite.id === id)
            if (source === undefined) return state
            const flow = cloneFlow(source.nodes, source.edges)
            const copy: Suite = {
              ...structuredClone(source),
              id: uid(),
              name: uniqueSuiteName(state.suites, `${source.name} (copy)`),
              nodes: flow.nodes,
              edges: flow.edges
            }
            const index = state.suites.findIndex((suite) => suite.id === id)
            const suites = [...state.suites]
            suites.splice(index + 1, 0, copy)
            return { suites, activeSuiteId: copy.id }
          }),

        renameSuite: (id, name, description) =>
          set((state) => ({
            suites: state.suites.map((suite) =>
              suite.id === id ? { ...suite, name, description: description ?? suite.description } : suite
            )
          })),

        removeSuite: (id) =>
          set((state) => {
            if (state.suites.length <= 1) return state // always keep at least one suite
            const index = state.suites.findIndex((suite) => suite.id === id)
            const suites = state.suites.filter((suite) => suite.id !== id)
            const activeSuiteId =
              state.activeSuiteId === id
                ? (suites[Math.max(0, index - 1)]?.id ?? suites[0].id)
                : state.activeSuiteId
            return { suites, activeSuiteId, past: [], future: [] }
          }),

        reorderSuites: (fromIndex, toIndex) =>
          set((state) => {
            const suites = [...state.suites]
            const [moved] = suites.splice(fromIndex, 1)
            suites.splice(toIndex, 0, moved)
            return { suites }
          }),

        setActiveSuite: (id) => set({ activeSuiteId: id, past: [], future: [], clipboard: null }),

        setSuiteExecution: (execution) => patchActive(() => ({ execution })),

        /* ---------------- Scenario management ---------------- */

        /**
         * Adds a workload to the active suite, wired to the journey that is
         * already on the canvas. A performance suite is a *set* of scenarios
         * over one journey, so reusing it is the default: adding a stress test
         * next to a smoke test costs one click and duplicates nothing.
         */
        addScenario: (typeId, options) => {
          get().pushHistory()
          const suite = selectActiveSuite(get())
          const name = uniqueScenarioName(suite.nodes, typeId)
          const { flow, scenarioId } = addScenarioToFlow({ nodes: suite.nodes, edges: suite.edges }, typeId, {
            reuseJourney: options?.reuseJourney,
            name
          })
          patchActive(() => ({ nodes: flow.nodes, edges: flow.edges }))
          get().selectScenario(scenarioId)
          return scenarioId
        },

        addScenarios: (typeIds, options) => {
          if (typeIds.length === 0) return []
          const ids: string[] = []
          /* Cheapest gate first, so the suite reads in the order it should run. */
          for (const typeId of sortScenarioTypeIds(typeIds)) {
            ids.push(get().addScenario(typeId, options))
          }
          if (ids.length > 0) get().selectScenario(ids[0])
          return ids
        },

        updateScenario: (nodeId, patch) => {
          const suite = selectActiveSuite(get())
          const node = suite.nodes.find((entry) => entry.id === nodeId)
          if (node === undefined || node.type !== 'scenario') return
          get().updateNodeData(nodeId, { scenario: { ...node.data.scenario, ...patch } })
        },

        setScenarioThresholds: (nodeId, thresholds) => get().updateScenario(nodeId, { thresholds }),

        toggleScenario: (nodeId, enabled) => get().updateScenario(nodeId, { enabled }),

        /**
         * Copies a scenario, including the journey it is wired to — the copy is a
         * starting point for a variant (same journey, different ramp), not a
         * second journey to maintain.
         */
        duplicateScenario: (nodeId) => {
          const suite = selectActiveSuite(get())
          const source = suite.nodes.find((entry) => entry.id === nodeId)
          if (source === undefined || source.type !== 'scenario') return null
          get().pushHistory()

          const copyId = uid()
          const copy = {
            ...structuredClone(source),
            id: copyId,
            selected: false,
            position: nextScenarioPosition(suite.nodes),
            data: {
              ...structuredClone(source.data),
              scenario: {
                ...structuredClone(source.data.scenario),
                id: copyId,
                name: uniqueScenarioName(suite.nodes, source.data.scenario.name)
              }
            }
          } as FlowNode

          /* Point the copy at the same first step, so it measures the same journey. */
          const outgoing = suite.edges
            .filter((edge) => edge.source === nodeId)
            .map((edge) => ({ ...edge, id: uid(), source: copyId }))

          const index = suite.nodes.findIndex((entry) => entry.id === nodeId)
          const nodes = [...suite.nodes]
          nodes.splice(index + 1, 0, copy)
          patchActive(() => ({ nodes, edges: [...suite.edges, ...outgoing] }))
          get().selectScenario(copyId)
          return copyId
        },

        /** Removes a scenario. The journey it measured stays — others may share it. */
        removeScenario: (nodeId) => get().removeNodes([nodeId]),

        /**
         * Reorders scenarios among themselves. The order is the order they are
         * emitted in `options.scenarios`, listed in the docs and run in the
         * generated scripts, so it is worth controlling.
         */
        reorderScenarios: (fromIndex, toIndex) => {
          const suite = selectActiveSuite(get())
          const positions = suite.nodes
            .map((node, index) => (node.type === 'scenario' ? index : -1))
            .filter((index) => index !== -1)
          if (
            fromIndex < 0 ||
            toIndex < 0 ||
            fromIndex >= positions.length ||
            toIndex >= positions.length ||
            fromIndex === toIndex
          ) {
            return
          }
          const scenarioNodes = positions.map((index) => suite.nodes[index])
          const [moved] = scenarioNodes.splice(fromIndex, 1)
          scenarioNodes.splice(toIndex, 0, moved)
          const nodes = [...suite.nodes]
          positions.forEach((index, slot) => {
            nodes[index] = scenarioNodes[slot]
          })
          patchActive(() => ({ nodes }))
        },

        /** Selects a scenario's node so the properties panel opens its config. */
        selectScenario: (nodeId) =>
          patchActive((suite) => ({
            nodes: suite.nodes.map((node) => ({ ...node, selected: node.id === nodeId }) as FlowNode)
          })),

        importSuite: (data) =>
          set((state) => {
            const suite: Suite = { ...data.suite, id: uid() }
            /* Merge unknown requests into the shared library */
            const existingKeys = new Set(state.requests.map((r) => `${r.method} ${r.url}`))
            const incoming = data.requests.filter((r) => !existingKeys.has(`${r.method} ${r.url}`))
            return {
              suites: [...state.suites, suite],
              activeSuiteId: suite.id,
              requests: [...state.requests, ...incoming]
            }
          }),

        /* ---------------- Canvas (active suite) ---------------- */

        onNodesChange: (changes) =>
          patchActive((suite) => ({ nodes: applyNodeChanges(changes, suite.nodes) as FlowNode[] })),

        onEdgesChange: (changes) =>
          patchActive((suite) => ({ edges: applyEdgeChanges(changes, suite.edges) })),

        onConnect: (connection) => {
          get().pushHistory()
          patchActive((suite) => ({ edges: addEdge({ ...connection, animated: true }, suite.edges) }))
        },

        addNode: (type, position, requestId) => {
          get().pushHistory()
          const state = get()
          const request = requestId !== undefined ? state.requests.find((r) => r.id === requestId) : undefined
          const nodeId = uid()
          const dimensions = NODE_DIMENSIONS[type]
          const node = {
            id: nodeId,
            type,
            position,
            data: createNodePayload(type, request),
            ...(dimensions !== undefined
              ? { width: dimensions.width, height: dimensions.height, style: dimensions }
              : {})
          } as FlowNode
          patchActive((suite) => ({ nodes: [...suite.nodes, node] }))
          return nodeId
        },

        updateNodeData: (nodeId, patch) =>
          patchActive((suite) => ({
            nodes: suite.nodes.map((node) =>
              node.id === nodeId ? ({ ...node, data: { ...node.data, ...patch } } as FlowNode) : node
            )
          })),

        removeNodes: (ids) => {
          if (ids.length === 0) return
          get().pushHistory()
          patchActive((suite) => {
            const removed = new Set(ids)
            for (const node of suite.nodes) {
              if (node.parentId !== undefined && removed.has(node.parentId)) removed.add(node.id)
            }
            return {
              nodes: suite.nodes.filter((node) => !removed.has(node.id)),
              edges: suite.edges.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target))
            }
          })
        },

        copySelection: () => {
          const suite = selectActiveSuite(get())
          const selected = suite.nodes.filter((node) => node.selected === true)
          if (selected.length === 0) return
          const ids = new Set(selected.map((node) => node.id))
          set({
            clipboard: {
              nodes: structuredClone(selected),
              edges: structuredClone(
                suite.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target))
              )
            }
          })
        },

        paste: () => {
          const { clipboard } = get()
          if (clipboard === null || clipboard.nodes.length === 0) return
          get().pushHistory()
          const idMap = new Map<string, string>()
          for (const node of clipboard.nodes) idMap.set(node.id, uid())
          const newNodes = clipboard.nodes.map((node) => {
            const clone = structuredClone(node)
            clone.id = idMap.get(node.id) ?? uid()
            clone.position = { x: node.position.x + 48, y: node.position.y + 48 }
            clone.selected = true
            if (clone.parentId !== undefined && idMap.has(clone.parentId)) {
              clone.parentId = idMap.get(clone.parentId)
            } else if (clone.parentId !== undefined) {
              delete clone.parentId
            }
            return clone
          })
          const newEdges = clipboard.edges.map((edge) => ({
            ...structuredClone(edge),
            id: uid(),
            source: idMap.get(edge.source) ?? edge.source,
            target: idMap.get(edge.target) ?? edge.target
          }))
          patchActive((suite) => ({
            nodes: [...suite.nodes.map((node) => ({ ...node, selected: false }) as FlowNode), ...newNodes],
            edges: [...suite.edges, ...newEdges]
          }))
        },

        duplicateSelection: () => {
          const savedClipboard = get().clipboard
          get().copySelection()
          get().paste()
          set({ clipboard: savedClipboard }) // don't clobber the user's clipboard
        },

        autoLayout: () => {
          get().pushHistory()
          patchActive((suite) => {
            const roots = suite.nodes.filter(
              (node) =>
                (node.type === 'scenario' || node.type === 'setup' || node.type === 'teardown') &&
                node.parentId === undefined
            )
            const positioned = new Map<string, { x: number; y: number }>()
            const COL = 320
            const ROW = 200
            let lane = 0

            const walk = (nodeId: string, depth: number, currentLane: number): number => {
              if (positioned.has(nodeId)) return currentLane
              positioned.set(nodeId, { x: 96 + depth * COL, y: 160 + currentLane * ROW })
              const outgoing = suite.edges.filter((edge) => edge.source === nodeId)
              let usedLane = currentLane
              outgoing.forEach((edge, branchIndex) => {
                usedLane = Math.max(usedLane, walk(edge.target, depth + 1, currentLane + branchIndex))
              })
              return usedLane
            }

            for (const root of roots) {
              lane = walk(root.id, 0, lane) + 1
            }

            let configIndex = 0
            for (const node of suite.nodes) {
              if (!CHAIN_TYPES.has((node.type ?? '') as FlowNodeType)) {
                positioned.set(node.id, { x: 96 + configIndex * 280, y: -100 })
                configIndex += 1
              }
            }

            return {
              nodes: suite.nodes.map((node) =>
                positioned.has(node.id) && node.parentId === undefined
                  ? ({ ...node, position: positioned.get(node.id) ?? node.position } as FlowNode)
                  : node
              )
            }
          })
        },

        pushHistory: () =>
          set((state) => {
            const suite = selectActiveSuite(state)
            return {
              past: [...state.past.slice(-MAX_HISTORY + 1), snapshot(suite)],
              future: []
            }
          }),

        undo: () =>
          set((state) => {
            const previous = state.past[state.past.length - 1]
            if (previous === undefined) return state
            const target = state.suites.find((suite) => suite.id === previous.suiteId)
            if (target === undefined) return { ...state, past: state.past.slice(0, -1) }
            return {
              ...state,
              past: state.past.slice(0, -1),
              future: [snapshot(target), ...state.future.slice(0, MAX_HISTORY - 1)],
              suites: state.suites.map((suite) =>
                suite.id === previous.suiteId
                  ? { ...suite, nodes: previous.nodes, edges: previous.edges }
                  : suite
              )
            }
          }),

        redo: () =>
          set((state) => {
            const next = state.future[0]
            if (next === undefined) return state
            const target = state.suites.find((suite) => suite.id === next.suiteId)
            if (target === undefined) return { ...state, future: state.future.slice(1) }
            return {
              ...state,
              future: state.future.slice(1),
              past: [...state.past.slice(-MAX_HISTORY + 1), snapshot(target)],
              suites: state.suites.map((suite) =>
                suite.id === next.suiteId ? { ...suite, nodes: next.nodes, edges: next.edges } : suite
              )
            }
          }),

        exportProject: () => {
          const state = get()
          return {
            version: 3,
            kind: 'k6-studio-project',
            meta: state.meta,
            requests: state.requests,
            requestGroups: state.requestGroups,
            suites: state.suites.map((suite) => ({
              ...suite,
              nodes: suite.nodes.map((node) => ({ ...node, selected: false }) as FlowNode)
            }))
          }
        },

        exportSuite: (id) => {
          const state = get()
          const suite = state.suites.find((entry) => entry.id === id) ?? state.suites[0]
          return {
            version: 3,
            kind: 'k6-studio-suite',
            suite: { ...suite, nodes: suite.nodes.map((node) => ({ ...node, selected: false }) as FlowNode) },
            requests: state.requests
          }
        },

        importProject: (data) => {
          const suites = data.suites.length > 0 ? data.suites : initialState().suites
          set({
            ...initialState(),
            meta: data.meta,
            requests: data.requests,
            requestGroups: data.requestGroups,
            suites,
            activeSuiteId: suites[0].id,
            step: 2
          })
        },

        resetProject: () => {
          const fresh = initialState()
          set({ ...fresh, activeSuiteId: fresh.suites[0].id })
        }
      }
    },
    {
      name: 'k6-studio-project',
      version: 3,
      migrate: (persisted: unknown, version: number): PersistedState => {
        const fallback = initialState()
        if (typeof persisted !== 'object' || persisted === null) {
          return { ...fallback, activeSuiteId: fallback.suites[0].id }
        }
        const state = persisted as Record<string, unknown>

        /* v1 stored a single canvas at the top level → wrap it in one suite. */
        const rawSuites: LegacySuite[] =
          version < 2
            ? [
                {
                  ...createSuite('Default Suite'),
                  nodes: (state.nodes as FlowNode[] | undefined) ?? [],
                  edges: (state.edges as FlowEdge[] | undefined) ?? [],
                  options: (state.options as GlobalOptions | undefined) ?? createGlobalOptions()
                }
              ]
            : ((state.suites as LegacySuite[] | undefined) ?? fallback.suites)

        /* v2 → v3: one test type per suite becomes one scenario per workload. */
        const suites = rawSuites.map(migrateSuiteToScenarios)
        const activeSuiteId = state.activeSuiteId as string | undefined
        return {
          meta: (state.meta as ProjectMeta | undefined) ?? fallback.meta,
          step: (state.step as WizardStep | undefined) ?? 1,
          curlText: (state.curlText as string | undefined) ?? '',
          requests: (state.requests as HttpRequestDef[] | undefined) ?? [],
          requestGroups: (state.requestGroups as Record<string, string> | undefined) ?? {},
          suites,
          activeSuiteId:
            activeSuiteId !== undefined && suites.some((suite) => suite.id === activeSuiteId)
              ? activeSuiteId
              : suites[0].id
        }
      },
      onRehydrateStorage: () => (state) => {
        /* Ensure a valid active suite after rehydration. */
        if (state !== undefined && !state.suites.some((suite) => suite.id === state.activeSuiteId)) {
          state.activeSuiteId = state.suites[0]?.id ?? ''
        }
      },
      partialize: (state) => ({
        meta: state.meta,
        step: state.step,
        curlText: state.curlText,
        requests: state.requests,
        requestGroups: state.requestGroups,
        /* Strip React Flow's transient `selected` flag before persisting. */
        suites: state.suites.map((suite) => ({
          ...suite,
          nodes: suite.nodes.map((node) => ({ ...node, selected: false }) as FlowNode)
        })),
        activeSuiteId: state.activeSuiteId
      })
    }
  )
)

/* Guarantee a valid activeSuiteId at construction time (before rehydration). */
{
  const state = useProjectStore.getState()
  if (!state.suites.some((suite) => suite.id === state.activeSuiteId)) {
    useProjectStore.setState({ activeSuiteId: state.suites[0].id })
  }
}

/** Structural check for imported project JSON (every version this app wrote). */
export function isProjectExport(value: unknown): value is ProjectExport {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    candidate.kind === 'k6-studio-project' &&
    (candidate.version === 1 || candidate.version === 2 || candidate.version === 3) &&
    typeof candidate.meta === 'object' &&
    Array.isArray(candidate.requests)
  )
}

export function isSuiteExport(value: unknown): value is SuiteExport {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return candidate.kind === 'k6-studio-suite' && typeof candidate.suite === 'object'
}

/** Normalizes any exported project (v1, v2, v3) into the current shape. */
export function normalizeProjectImport(value: ProjectExport | Record<string, unknown>): ProjectExport {
  const candidate = value as Record<string, unknown>
  const legacySuites: LegacySuite[] = Array.isArray(candidate.suites)
    ? (candidate.suites as LegacySuite[])
    : [
        {
          ...createSuite('Default Suite'),
          nodes: (candidate.nodes as FlowNode[] | undefined) ?? [],
          edges: (candidate.edges as FlowEdge[] | undefined) ?? [],
          options: (candidate.options as GlobalOptions | undefined) ?? createGlobalOptions()
        }
      ]
  return {
    version: 3,
    kind: 'k6-studio-project',
    meta: (candidate.meta as ProjectMeta | undefined) ?? { name: '', description: '', baseUrl: '' },
    requests: (candidate.requests as HttpRequestDef[] | undefined) ?? [],
    requestGroups: (candidate.requestGroups as Record<string, string> | undefined) ?? {},
    suites: legacySuites.map(migrateSuiteToScenarios)
  }
}

/** Normalizes an exported suite (v2 or v3) into the current shape. */
export function normalizeSuiteImport(data: SuiteExport | Record<string, unknown>): SuiteExport {
  const candidate = data as Record<string, unknown>
  return {
    version: 3,
    kind: 'k6-studio-suite',
    suite: migrateSuiteToScenarios(candidate.suite as LegacySuite),
    requests: (candidate.requests as HttpRequestDef[] | undefined) ?? []
  }
}
