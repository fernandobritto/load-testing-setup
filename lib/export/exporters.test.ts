import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { createGlobalOptions } from '@/lib/dsl/defaults'
import type { EnvVarDef, ScenarioExecutionMode, TestPlan } from '@/lib/dsl/types'
import type { ScenarioTypeId } from '@/lib/k6/scenario-types'
import type { ProjectExport, ProjectMeta } from '@/stores/project-store'
import {
  buildProjectZip,
  inRunOrder,
  scenarioRuns,
  suiteFileName,
  type ScenarioArtifact,
  type SuiteArtifact
} from './exporters'

const META: ProjectMeta = {
  name: 'Checkout Perf',
  description: 'Checkout journey',
  baseUrl: 'https://api.test'
}

function plan(envVars: EnvVarDef[] = []): TestPlan {
  return {
    meta: META,
    options: createGlobalOptions(),
    execution: 'one-at-a-time',
    scenarios: [],
    thresholds: [],
    customMetrics: [],
    envVars,
    sharedData: [],
    hasSetup: false,
    setupSteps: [],
    hasTeardown: false,
    teardownSteps: []
  }
}

function scenario(typeId: ScenarioTypeId, key: string = typeId): ScenarioArtifact {
  return { key, name: key, typeId, description: `${typeId} scenario` }
}

function suite(
  name: string,
  scenarios: ScenarioArtifact[],
  options: { envVars?: EnvVarDef[]; execution?: ScenarioExecutionMode } = {}
): SuiteArtifact {
  return {
    id: name,
    name,
    description: `${name} description`,
    execution: options.execution ?? 'one-at-a-time',
    scenarios,
    fileName: suiteFileName(name, new Set<string>()),
    plan: plan(options.envVars),
    script: `// ${name}`
  }
}

const PROJECT_JSON = { version: 3, kind: 'k6-studio-project' } as unknown as ProjectExport

async function filesOf(artifacts: SuiteArtifact[]): Promise<Record<string, string>> {
  const blob = await buildProjectZip(META, artifacts, PROJECT_JSON)
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  const entries = await Promise.all(
    Object.keys(zip.files)
      .filter((path) => !zip.files[path].dir)
      .map(async (path) => [path, await zip.files[path].async('string')] as const)
  )
  return Object.fromEntries(entries)
}

/** The suite a normal project produces: one script, several workloads. */
const oneSuite = [
  suite('Performance Suite', [scenario('smoke'), scenario('stress'), scenario('soak'), scenario('load')])
]

describe('scenarioRuns', () => {
  it('runs cheap gates first and multi-hour scenarios last', () => {
    const runs = scenarioRuns(oneSuite)
    expect(runs.map((run) => run.key)).toEqual(['smoke', 'load', 'stress', 'soak'])
    expect(runs.map((run) => run.longRunning)).toEqual([false, false, false, true])
  })

  it('selects each scenario with -e SCENARIO=', () => {
    const runs = scenarioRuns(oneSuite)
    expect(runs[0].scenarioKey).toBe('smoke')
  })

  it('runs a combined-workload suite as a single command', () => {
    const runs = scenarioRuns([
      suite('Mixed Workload', [scenario('load'), scenario('custom')], { execution: 'all-together' })
    ])
    expect(runs).toHaveLength(1)
    expect(runs[0].scenarioKey).toBeNull()
    expect(runs[0].key).toBe('mixed-workload')
  })

  it('needs no selector when a suite holds a single scenario', () => {
    const runs = scenarioRuns([suite('Solo', [scenario('smoke')])])
    expect(runs[0].scenarioKey).toBeNull()
    expect(runs[0].key).toBe('smoke')
  })

  it('disambiguates the same scenario name in two suites', () => {
    const runs = scenarioRuns([
      suite('Checkout', [scenario('smoke'), scenario('load')]),
      suite('Search', [scenario('smoke'), scenario('load')])
    ])
    expect(runs.map((run) => run.key)).toEqual(['smoke', 'search-smoke', 'load', 'search-load'])
  })
})

describe('inRunOrder', () => {
  it('orders suites by the cheapest scenario they contain', () => {
    const ordered = inRunOrder([
      suite('Soak Only', [scenario('soak')]),
      suite('Gate', [scenario('smoke')]),
      suite('Heavy', [scenario('stress')])
    ])
    expect(ordered.map((entry) => entry.name)).toEqual(['Gate', 'Heavy', 'Soak Only'])
  })

  it('keeps scenario-less suites in project order, after the others', () => {
    const ordered = inRunOrder([
      suite('Empty B', []),
      suite('Empty A', []),
      suite('Gate', [scenario('smoke')])
    ])
    expect(ordered.map((entry) => entry.name)).toEqual(['Gate', 'Empty B', 'Empty A'])
  })
})

describe('buildProjectZip', () => {
  const artifacts = [
    suite('Performance Suite', [scenario('smoke'), scenario('stress'), scenario('soak')], {
      envVars: [{ id: 'e1', name: 'USERNAME', defaultValue: 'alice', required: false, description: '' }]
    }),
    suite('Search Suite', [scenario('load')], {
      envVars: [{ id: 'e2', name: 'API_TOKEN', defaultValue: '', required: true, description: '' }]
    })
  ]

  it('writes one script per suite', async () => {
    const files = await filesOf(artifacts)
    expect(
      Object.keys(files)
        .filter((path) => path.startsWith('scripts/'))
        .sort()
    ).toEqual(['scripts/performance-suite.js', 'scripts/search-suite.js'])
  })

  it('merges env vars from every suite into the environment files', async () => {
    const files = await filesOf(artifacts)
    const staging = JSON.parse(files['environments/staging.json'])

    /* API_TOKEN is only declared by the search suite — it must still be there. */
    expect(staging.USERNAME).toBe('alice')
    expect(staging.API_TOKEN).toBe('<staging-api_token>')
    expect(staging.BASE_URL).toBe('https://api.test')
  })

  it('gives every scenario an npm script plus all/quick chains', async () => {
    const files = await filesOf(artifacts)
    const { scripts } = JSON.parse(files['package.json'])

    expect(scripts.smoke).toBe('k6 run -e SCENARIO=smoke scripts/performance-suite.js')
    expect(scripts.load).toBe('k6 run scripts/search-suite.js')
    expect(scripts.all).toBe(
      [
        'k6 run -e SCENARIO=smoke scripts/performance-suite.js',
        'k6 run scripts/search-suite.js',
        'k6 run -e SCENARIO=stress scripts/performance-suite.js',
        'k6 run -e SCENARIO=soak scripts/performance-suite.js'
      ].join(' && ')
    )
    /* `quick` is the CI-safe chain: the 4-hour soak is left out. */
    expect(scripts.quick).toBe(
      [
        'k6 run -e SCENARIO=smoke scripts/performance-suite.js',
        'k6 run scripts/search-suite.js',
        'k6 run -e SCENARIO=stress scripts/performance-suite.js'
      ].join(' && ')
    )
  })

  it('omits the quick chain when nothing is long-running', async () => {
    const files = await filesOf([suite('Suite', [scenario('smoke'), scenario('load')])])
    const { scripts } = JSON.parse(files['package.json'])
    expect(scripts.quick).toBeUndefined()
    expect(scripts.all).toBe(
      'k6 run -e SCENARIO=smoke scripts/suite.js && k6 run -e SCENARIO=load scripts/suite.js'
    )
  })

  it('does not let a scenario name collide with the all chain', async () => {
    const files = await filesOf([suite('Suite', [scenario('smoke', 'all'), scenario('load')])])
    const { scripts } = JSON.parse(files['package.json'])
    expect(scripts.all).toBe('k6 run -e SCENARIO=all scripts/suite.js')
    expect(scripts['all-scenarios']).toContain('&&')
  })

  it('hides long-running scenarios behind a compose profile', async () => {
    const compose = (await filesOf(artifacts))['docker-compose.yml']

    expect(compose).toContain('soak:')
    expect(compose.slice(compose.indexOf('soak:'))).toContain('profiles: [long]')
    expect(compose.slice(compose.indexOf('smoke:'), compose.indexOf('stress:'))).not.toContain('profiles')
    expect(compose).toContain('command: run -e SCENARIO=stress scripts/performance-suite.js')
  })

  it('runs scenarios in order in run.sh and can skip the long ones', async () => {
    const script = (await filesOf(artifacts))['run.sh']

    expect(script.indexOf('› smoke')).toBeLessThan(script.indexOf('› stress'))
    expect(script).toContain(`run 'Performance Suite › soak' 'performance-suite.js' 'soak' 1`)
    expect(script).toContain(`run 'Performance Suite › smoke' 'performance-suite.js' 'smoke' 0`)
    expect(script).toContain('SKIP_LONG')
    expect(script).toContain('k6 run -e "SCENARIO=$scenario"')
  })

  it('documents each scenario, the run order and the long-running ones', async () => {
    const readme = (await filesOf(artifacts))['README.md']

    expect(readme).toContain('## Suites and scenarios')
    expect(readme).toContain('`scripts/performance-suite.js`')
    expect(readme).toContain('3 scenarios, run one at a time')
    expect(readme).toContain('Does the script work and the system respond correctly at all?')
    expect(readme).toContain('**Recommended order:** smoke → load → stress → soak')
    expect(readme).toContain('**Long-running:** soak (~4 hours)')
    expect(readme).toContain('npm run quick')
  })

  it('escapes names that would break the shell or the table', async () => {
    const files = await filesOf([suite("Bob's | Suite", [scenario('smoke'), scenario('load')])])
    expect(files['run.sh']).toContain(`run 'Bob'\\''s | Suite › smoke'`)
    expect(files['README.md']).toContain("Bob's \\| Suite")
  })
})
