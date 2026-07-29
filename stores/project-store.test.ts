import { beforeEach, describe, expect, it } from 'vitest'
import { createGlobalOptions, createRequest, createThreshold } from '@/lib/dsl/defaults'
import type { FlowNode } from '@/lib/flow/types'
import { scenarioType } from '@/lib/k6/scenario-types'
import {
  normalizeProjectImport,
  scenarioNodesOf,
  selectActiveSuite,
  useProjectStore,
  type ProjectExport
} from './project-store'

/* ------------------------------------------------------------------ */
/* Migration: v1/v2 projects must survive the scenario refactor        */
/* ------------------------------------------------------------------ */

/** A v2 project as the previous version persisted it: one test type per suite. */
function v2Project(): Record<string, unknown> {
  return {
    version: 2,
    kind: 'k6-studio-project',
    meta: { name: 'Legacy', description: '', baseUrl: 'https://api.test' },
    requests: [],
    requestGroups: {},
    suites: [
      {
        id: 'suite-stress',
        name: 'Stress Test',
        description: 'Above-normal load',
        presetHint: 'stress',
        options: createGlobalOptions(),
        nodes: [
          {
            id: 'sc',
            type: 'scenario',
            position: { x: 0, y: 0 },
            /* The old ScenarioDef: no typeId, description, enabled or thresholds. */
            data: {
              scenario: {
                id: 'sc',
                name: 'stress',
                executor: scenarioType('stress').buildExecutor(),
                startTime: '0s',
                gracefulStop: '30s',
                tags: [],
                env: []
              }
            }
          },
          {
            id: 'req',
            type: 'request',
            position: { x: 300, y: 0 },
            data: { request: createRequest({ name: 'List', url: 'https://api.test/list' }) }
          },
          {
            id: 'gate-preset',
            type: 'threshold',
            position: { x: 0, y: -80 },
            data: {
              threshold: { ...createThreshold('http_req_duration'), id: 'gate-preset' },
              fromPreset: true
            }
          },
          {
            id: 'gate-manual',
            type: 'threshold',
            position: { x: 280, y: -80 },
            data: { threshold: { ...createThreshold('checks'), id: 'gate-manual' } }
          }
        ],
        edges: [{ id: 'e1', source: 'sc', target: 'req' }]
      }
    ]
  }
}

describe('normalizeProjectImport', () => {
  it('moves a v2 suite test type onto its scenario', () => {
    const project = normalizeProjectImport(v2Project())
    expect(project.version).toBe(3)

    const [suite] = project.suites
    expect(suite.execution).toBe('one-at-a-time')

    const [scenario] = scenarioNodesOf(suite.nodes).map((node) => node.data.scenario)
    expect(scenario.typeId).toBe('stress')
    expect(scenario.enabled).toBe(true)
    expect(scenario.name).toBe('stress')
  })

  it('turns the preset gates into the scenario’s own gates', () => {
    const [suite] = normalizeProjectImport(v2Project()).suites
    const [scenario] = scenarioNodesOf(suite.nodes).map((node) => node.data.scenario)

    /* The preset threshold node is gone from the canvas… */
    const canvasGates = suite.nodes.filter((node) => node.type === 'threshold')
    expect(canvasGates.map((node) => node.id)).toEqual(['gate-manual'])
    /* …and now belongs to the scenario, scoped to it. */
    expect(scenario.thresholds.map((gate) => gate.metric)).toEqual(['http_req_duration'])
  })

  it('keeps the journey and its wiring intact', () => {
    const [suite] = normalizeProjectImport(v2Project()).suites
    expect(suite.nodes.filter((node) => node.type === 'request')).toHaveLength(1)
    expect(suite.edges).toHaveLength(1)
  })

  it('wraps a v1 project (single top-level canvas) into one suite', () => {
    const v1 = {
      version: 1,
      kind: 'k6-studio-project',
      meta: { name: 'Ancient', description: '', baseUrl: '' },
      requests: [],
      requestGroups: {},
      nodes: [
        {
          id: 'req',
          type: 'request',
          position: { x: 0, y: 0 },
          data: { request: createRequest({ name: 'Ping', url: 'https://api.test/ping' }) }
        }
      ],
      edges: []
    }
    const project = normalizeProjectImport(v1)
    expect(project.suites).toHaveLength(1)
    expect(project.suites[0].nodes).toHaveLength(1)
    expect(project.suites[0].execution).toBe('one-at-a-time')
  })
})

/* ------------------------------------------------------------------ */
/* Scenario management                                                 */
/* ------------------------------------------------------------------ */

/** Imports a project whose canvas holds one scenario wired to one request. */
function loadJourneyProject(): void {
  useProjectStore.getState().importProject(normalizeProjectImport(v2Project()) as ProjectExport)
}

const activeScenarios = (): ReturnType<typeof scenarioNodesOf> =>
  scenarioNodesOf(selectActiveSuite(useProjectStore.getState()).nodes)

describe('scenario management', () => {
  beforeEach(() => {
    useProjectStore.getState().resetProject()
    loadJourneyProject()
  })

  it('wires a new scenario to the journey already on the canvas', () => {
    useProjectStore.getState().addScenario('soak')
    const suite = selectActiveSuite(useProjectStore.getState())
    const added = activeScenarios().find((node) => node.data.scenario.typeId === 'soak')

    expect(added).toBeDefined()
    expect(suite.edges.some((edge) => edge.source === added?.id && edge.target === 'req')).toBe(true)
    /* Nothing was duplicated — still one request. */
    expect(suite.nodes.filter((node) => node.type === 'request')).toHaveLength(1)
  })

  it('gives every scenario a unique name and its own gates', () => {
    const store = useProjectStore.getState()
    store.addScenario('stress')
    store.addScenario('stress')
    const names = activeScenarios().map((node) => node.data.scenario.name)

    expect(new Set(names).size).toBe(names.length)
    expect(names).toEqual(['stress', 'stress-2', 'stress-3'])
  })

  it('keeps scenarios isolated when one is edited', () => {
    useProjectStore.getState().addScenario('load')
    const [first, second] = activeScenarios()
    useProjectStore.getState().setScenarioThresholds(second.id, [])
    useProjectStore.getState().updateScenario(second.id, { startTime: '5m' })

    const after = activeScenarios()
    expect(after.find((node) => node.id === second.id)?.data.scenario.thresholds).toEqual([])
    expect(after.find((node) => node.id === second.id)?.data.scenario.startTime).toBe('5m')
    expect(after.find((node) => node.id === first.id)?.data.scenario.thresholds.length).toBeGreaterThan(0)
    expect(after.find((node) => node.id === first.id)?.data.scenario.startTime).toBe('0s')
  })

  it('duplicates a scenario, wiring the copy to the same journey', () => {
    const [source] = activeScenarios()
    const copyId = useProjectStore.getState().duplicateScenario(source.id)
    const suite = selectActiveSuite(useProjectStore.getState())

    expect(copyId).not.toBeNull()
    expect(activeScenarios()).toHaveLength(2)
    expect(suite.edges.some((edge) => edge.source === copyId && edge.target === 'req')).toBe(true)
    /* The copy is independent: same shape, different identity and name. */
    const copy = activeScenarios().find((node) => node.id === copyId)
    expect(copy?.data.scenario.name).not.toBe(source.data.scenario.name)
    expect(copy?.data.scenario.typeId).toBe(source.data.scenario.typeId)
  })

  it('removes a scenario without touching the journey it measured', () => {
    useProjectStore.getState().addScenario('spike')
    const [, spike] = activeScenarios()
    useProjectStore.getState().removeScenario(spike.id)

    const suite = selectActiveSuite(useProjectStore.getState())
    expect(activeScenarios()).toHaveLength(1)
    expect(suite.nodes.filter((node) => node.type === 'request')).toHaveLength(1)
    expect(suite.edges.some((edge) => edge.source === spike.id)).toBe(false)
  })

  it('reorders scenarios without disturbing the other nodes', () => {
    const store = useProjectStore.getState()
    store.addScenario('load')
    store.addScenario('soak')
    const before = selectActiveSuite(useProjectStore.getState()).nodes.map((node) => node.type)

    useProjectStore.getState().reorderScenarios(0, 2)

    const after = selectActiveSuite(useProjectStore.getState())
    expect(after.nodes.map((node) => node.type)).toEqual(before)
    expect(activeScenarios().map((node) => node.data.scenario.typeId)).toEqual(['load', 'soak', 'stress'])
  })

  it('toggles a scenario without removing it', () => {
    const [scenario] = activeScenarios()
    useProjectStore.getState().toggleScenario(scenario.id, false)

    expect(activeScenarios()).toHaveLength(1)
    expect(activeScenarios()[0].data.scenario.enabled).toBe(false)
  })

  it('starts a scenario unwired when the journey is not reused', () => {
    useProjectStore.getState().addScenario('capacity', { reuseJourney: false })
    const suite = selectActiveSuite(useProjectStore.getState())
    const added = activeScenarios().find((node) => node.data.scenario.typeId === 'capacity')

    expect(suite.edges.some((edge) => edge.source === added?.id)).toBe(false)
  })

  it('adds several scenarios in campaign order', () => {
    useProjectStore.getState().resetProject()
    const suiteId = selectActiveSuite(useProjectStore.getState()).id
    /* Start from a canvas with no scenarios at all. */
    useProjectStore.setState((state) => ({
      suites: state.suites.map((suite) =>
        suite.id === suiteId ? { ...suite, nodes: [] as FlowNode[], edges: [] } : suite
      )
    }))

    useProjectStore.getState().addScenarios(['soak', 'smoke', 'stress'])
    expect(activeScenarios().map((node) => node.data.scenario.typeId)).toEqual(['smoke', 'stress', 'soak'])
  })

  it('switches how the suite runs its scenarios', () => {
    useProjectStore.getState().setSuiteExecution('all-together')
    expect(selectActiveSuite(useProjectStore.getState()).execution).toBe('all-together')
  })
})
