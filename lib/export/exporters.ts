import JSZip from 'jszip'
import type { EnvVarDef, ScenarioExecutionMode, TestPlan } from '@/lib/dsl/types'
import { maybeScenarioType, scenarioTypeOrder, type ScenarioTypeId } from '@/lib/k6/scenario-types'
import type { ProjectExport, ProjectMeta } from '@/stores/project-store'

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export function downloadText(content: string, filename: string, mime = 'text/plain'): void {
  downloadBlob(new Blob([content], { type: `${mime};charset=utf-8` }), filename)
}

export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug === '' ? 'k6-test' : slug
}

/** One scenario inside a generated script. */
export interface ScenarioArtifact {
  /** Key in options.scenarios — and the value passed to `-e SCENARIO=`. */
  key: string
  name: string
  typeId: ScenarioTypeId
  description: string
}

/** One suite ready for export: its plan, generated script and target filename. */
export interface SuiteArtifact {
  id: string
  name: string
  description: string
  /** Whether its scenarios are alternatives or one combined workload. */
  execution: ScenarioExecutionMode
  scenarios: ScenarioArtifact[]
  fileName: string
  plan: TestPlan
  script: string
}

/** A single k6 invocation the generated project offers. */
export interface ScenarioRun {
  /** npm script key and compose service name; unique across the project. */
  key: string
  /** Human label, e.g. `Performance Suite › stress`. */
  label: string
  suite: SuiteArtifact
  /** The scenarios this invocation runs — one, or all of them together. */
  scenarios: ScenarioArtifact[]
  /** Value for `-e SCENARIO=`, or null when the script needs no selector. */
  scenarioKey: string | null
  longRunning: boolean
}

function isLongRunningType(typeId: ScenarioTypeId): boolean {
  return maybeScenarioType(typeId)?.longRunning ?? false
}

/** The k6 arguments for a run, relative to the project root. */
export function runArgs(run: ScenarioRun): string {
  const selector = run.scenarioKey === null ? '' : `-e SCENARIO=${run.scenarioKey} `
  return `${selector}scripts/${run.suite.fileName}`
}

export function runCommand(run: ScenarioRun): string {
  return `k6 run ${runArgs(run)}`
}

/**
 * Every invocation a suite offers.
 *
 * Scenarios that are alternatives (the usual case — smoke *or* load *or* soak
 * over one journey) each get their own command, because running a four-hour soak
 * next to a smoke test measures neither. Scenarios that form one combined
 * workload are a single command, since splitting them would change the test.
 */
function suiteRuns(suite: SuiteArtifact): ScenarioRun[] {
  if (suite.scenarios.length === 0) return []

  if (suite.execution === 'all-together' || suite.scenarios.length === 1) {
    return [
      {
        key: suite.scenarios.length === 1 ? suite.scenarios[0].key : slugify(suite.name),
        label: suite.scenarios.length === 1 ? `${suite.name} › ${suite.scenarios[0].name}` : suite.name,
        suite,
        scenarios: suite.scenarios,
        scenarioKey: null,
        longRunning: suite.scenarios.some((scenario) => isLongRunningType(scenario.typeId))
      }
    ]
  }

  return suite.scenarios.map((scenario) => ({
    key: scenario.key,
    label: `${suite.name} › ${scenario.name}`,
    suite,
    scenarios: [scenario],
    scenarioKey: scenario.key,
    longRunning: isLongRunningType(scenario.typeId)
  }))
}

/** Cheapest scenario a suite contains — decides where the suite sorts. */
function suiteOrder(suite: SuiteArtifact): number {
  if (suite.scenarios.length === 0) return Number.MAX_SAFE_INTEGER
  return Math.min(...suite.scenarios.map((scenario) => scenarioTypeOrder(scenario.typeId)))
}

/**
 * The order a campaign should run in: cheap gates first, so a broken build fails
 * in a minute instead of four hours, and multi-hour runs last. Suites keep their
 * project order within the same tier.
 */
export function inRunOrder(artifacts: SuiteArtifact[]): SuiteArtifact[] {
  return artifacts
    .map((artifact, index) => ({ artifact, index }))
    .sort((a, b) => {
      const byType = suiteOrder(a.artifact) - suiteOrder(b.artifact)
      return byType !== 0 ? byType : a.index - b.index
    })
    .map((entry) => entry.artifact)
}

/** Ensures npm-script / service keys stay unique across the whole project. */
function uniqueRunKeys(runs: ScenarioRun[]): ScenarioRun[] {
  const taken = new Set<string>()
  return runs.map((run) => {
    let key = run.key
    if (taken.has(key)) key = `${slugify(run.suite.name)}-${run.key}`
    let counter = 2
    while (taken.has(key)) {
      key = `${slugify(run.suite.name)}-${run.key}-${counter}`
      counter += 1
    }
    taken.add(key)
    return { ...run, key }
  })
}

/**
 * Every runnable scenario in the project, ordered the way a campaign executes
 * them: smoke gates first, multi-hour soaks last.
 */
export function scenarioRuns(artifacts: SuiteArtifact[]): ScenarioRun[] {
  const runs = artifacts.flatMap((artifact, suiteIndex) =>
    suiteRuns(artifact).map((run, runIndex) => ({ run, suiteIndex, runIndex }))
  )
  runs.sort((a, b) => {
    const orderOf = (entry: (typeof runs)[number]): number =>
      Math.min(...entry.run.scenarios.map((scenario) => scenarioTypeOrder(scenario.typeId)))
    const byType = orderOf(a) - orderOf(b)
    if (byType !== 0) return byType
    if (a.suiteIndex !== b.suiteIndex) return a.suiteIndex - b.suiteIndex
    return a.runIndex - b.runIndex
  })
  return uniqueRunKeys(runs.map((entry) => entry.run))
}

/** Escapes a user-supplied string for a single-quoted shell word. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** Escapes a user-supplied string for a Markdown table cell. */
function mdCell(value: string): string {
  return value.replace(/\|/g, '\\|')
}

/** Ensures suite filenames are unique within the ZIP. */
export function suiteFileName(name: string, taken: Set<string>): string {
  const base = slugify(name)
  let candidate = `${base}.js`
  let counter = 2
  while (taken.has(candidate)) {
    candidate = `${base}-${counter}.js`
    counter += 1
  }
  taken.add(candidate)
  return candidate
}

/**
 * Grafana Cloud k6 configuration reference.
 * https://grafana.com/docs/grafana-cloud/testing/k6/author-run/cloud-scripting-extras/cloud-options/
 */
export function buildCloudConfig(plan: TestPlan): string {
  return JSON.stringify(
    {
      name: plan.meta.name || 'k6 load test',
      note: 'Merge this object into a script as options.cloud, or run with: k6 cloud run <script>.js',
      cloud: {
        name: plan.meta.name || 'k6 load test',
        distribution: { default: { loadZone: 'amazon:us:ashburn', percent: 100 } }
      }
    },
    null,
    2
  )
}

/* ------------------------------------------------------------------ */
/* Shared library files (illustrative, runnable k6 utilities)          */
/* ------------------------------------------------------------------ */

function sharedConfig(meta: ProjectMeta): string {
  const baseUrl = meta.baseUrl.trim().replace(/\/$/, '') || 'https://api.example.com'
  return `// Shared configuration for every suite in this project.
// Override BASE_URL at runtime: k6 run -e BASE_URL=https://staging.example.com scripts/<suite>.js

export const BASE_URL = __ENV.BASE_URL || '${baseUrl}'

// Environment name drives which environments/*.json a runner would load.
export const ENVIRONMENT = __ENV.ENVIRONMENT || 'staging'

// Common thresholds you can spread into a suite's options.thresholds.
export const commonThresholds = {
  http_req_failed: ['rate<0.01'],
  http_req_duration: ['p(95)<500']
}
`
}

function sharedHelpers(): string {
  return `import { check } from 'k6'

// Pick a random element from a SharedArray or plain array.
export function randomItem (items) {
  return items[Math.floor(Math.random() * items.length)]
}

// Build an Authorization header from a bearer token.
export function bearer (token) {
  return { Authorization: \`Bearer \${token}\` }
}

// Assert a response is a 2xx and record it as a named check.
export function expectOk (res, name) {
  return check(res, { [\`\${name} is 2xx\`]: (r) => r.status >= 200 && r.status < 300 })
}
`
}

/**
 * Env vars declared by any suite. A single env file has to cover the whole
 * project, so a variable introduced in the stress suite must not go missing just
 * because the smoke suite never referenced it.
 */
function mergedEnvVars(artifacts: SuiteArtifact[]): EnvVarDef[] {
  const byName = new Map<string, EnvVarDef>()
  for (const artifact of artifacts) {
    for (const envVar of artifact.plan.envVars) {
      const name = envVar.name.trim()
      if (name === '' || name === 'BASE_URL' || byName.has(name)) continue
      byName.set(name, envVar)
    }
  }
  return [...byName.values()]
}

function environmentFile(name: string, meta: ProjectMeta, artifacts: SuiteArtifact[]): string {
  const body: Record<string, string> = {
    BASE_URL: meta.baseUrl.trim().replace(/\/$/, '') || `https://${name}.example.com`
  }
  for (const envVar of mergedEnvVars(artifacts)) {
    const varName = envVar.name.trim()
    body[varName] = envVar.defaultValue || `<${name}-${varName.toLowerCase()}>`
  }
  return JSON.stringify(body, null, 2)
}

/** Picks a script name that no scenario has already claimed. */
function freeScriptKey(scripts: Record<string, string>, base: string): string {
  if (scripts[base] === undefined) return base
  let candidate = `${base}-scenarios`
  let counter = 2
  while (scripts[candidate] !== undefined) {
    candidate = `${base}-scenarios-${counter}`
    counter += 1
  }
  return candidate
}

function packageJson(meta: ProjectMeta, artifacts: SuiteArtifact[]): string {
  const runs = scenarioRuns(artifacts)
  const scripts: Record<string, string> = {}
  for (const run of runs) {
    scripts[run.key] = runCommand(run)
  }

  const chain = (subset: ScenarioRun[]): string => subset.map(runCommand).join(' && ')

  /* Every scenario in the recommended order… */
  scripts[freeScriptKey(scripts, 'all')] = chain(runs)
  /* …and the same minus the multi-hour ones, which is what belongs in CI. */
  const quick = runs.filter((run) => !run.longRunning)
  if (quick.length > 0 && quick.length !== runs.length) {
    scripts[freeScriptKey(scripts, 'quick')] = chain(quick)
  }

  return JSON.stringify(
    {
      name: slugify(meta.name),
      version: '1.0.0',
      private: true,
      description: meta.description || 'k6 performance tests generated by K6 Studio Builder',
      scripts,
      engines: { k6: '>=1.0.0' }
    },
    null,
    2
  )
}

function dockerfile(firstRun: ScenarioRun | undefined): string {
  return `# Run any scenario inside the official k6 image, no local install required:
#   docker build -t perf-tests .
#   docker run --rm perf-tests run ${firstRun === undefined ? 'scripts/suite.js' : runArgs(firstRun)}
FROM grafana/k6:latest
WORKDIR /tests
COPY . .
ENTRYPOINT ["k6"]
`
}

function dockerCompose(artifacts: SuiteArtifact[]): string {
  const runs = scenarioRuns(artifacts)
  const services = runs
    .map((run) => {
      /* Long scenarios sit behind a profile so `docker compose up` cannot start a
         four-hour soak by accident. */
      const profile = run.longRunning ? '\n    profiles: [long]' : ''
      return `  ${run.key}:
    image: grafana/k6:latest
    volumes:
      - ./:/tests
    working_dir: /tests${profile}
    command: run ${runArgs(run)}`
    })
    .join('\n')
  return `# One service per scenario. Run a single one:
#   docker compose run --rm ${runs[0]?.key ?? 'smoke'}
# Multi-hour scenarios are behind the "long" profile:
#   docker compose --profile long run --rm <service>
services:
${services}
`
}

function runScript(artifacts: SuiteArtifact[]): string {
  const calls = scenarioRuns(artifacts)
    .map(
      (run) =>
        `run ${shellQuote(run.label)} ${shellQuote(run.suite.fileName)} ${shellQuote(
          run.scenarioKey ?? ''
        )} ${run.longRunning ? '1' : '0'}`
    )
    .join('\n')

  return `#!/usr/bin/env bash
# Runs every scenario in the recommended order: cheap gates first, so a broken
# build fails in a minute instead of hours.
#
#   ./run.sh                                          every scenario
#   SKIP_LONG=1 ./run.sh                              skip the multi-hour ones
#   ./run.sh -e BASE_URL=https://staging.example.com  extra flags go to k6
set -euo pipefail
DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
K6_ARGS=("$@")
SKIP_LONG="\${SKIP_LONG:-0}"

run () {
  local name="$1" file="$2" scenario="$3" long="$4"
  if [ "$long" = '1' ] && [ "$SKIP_LONG" != '0' ]; then
    echo "⏭  Skipping $name — long-running"
    return
  fi
  echo "▶ $name  (scripts/$file)"
  if [ -n "$scenario" ]; then
    k6 run -e "SCENARIO=$scenario" "$DIR/scripts/$file" \${K6_ARGS[@]+"\${K6_ARGS[@]}"}
  else
    k6 run "$DIR/scripts/$file" \${K6_ARGS[@]+"\${K6_ARGS[@]}"}
  fi
}

${calls}
`
}

function gitignore(): string {
  return `node_modules/
*.log
summary.json
results/
`
}

function projectReadme(meta: ProjectMeta, artifacts: SuiteArtifact[]): string {
  const runs = scenarioRuns(artifacts)
  const long = runs.filter((run) => run.longRunning)
  const hasQuick = long.length > 0 && long.length !== runs.length
  const multiSuite = artifacts.length > 1

  const scenarioRows = runs
    .map((run) => {
      const type = maybeScenarioType(run.scenarios[0]?.typeId)
      const label = run.scenarios.length === 1 ? run.scenarios[0].name : `${run.scenarios.length} together`
      const answers =
        run.scenarios.length === 1
          ? (type?.answers ?? run.scenarios[0].description)
          : run.scenarios.map((scenario) => scenario.name).join(' + ')
      return `| \`npm run ${run.key}\` | ${mdCell(label)} | ${mdCell(type?.label ?? 'Custom')} | ${mdCell(
        answers || '—'
      )} | ${type?.approxDuration ?? '—'} |${multiSuite ? '' : ''}`
    })
    .join('\n')

  const runOrder = runs
    .map((run) => (run.scenarios.length === 1 ? run.scenarios[0].name : run.suite.name))
    .join(' → ')

  const scenarioCommands = runs.map(runCommand).join('\n')

  const longNote =
    long.length === 0
      ? ''
      : `\n> **Long-running:** ${long
          .map((run) => {
            const type = maybeScenarioType(run.scenarios[0]?.typeId)
            return `${mdCell(run.scenarios[0]?.name ?? run.label)} (${type?.approxDuration ?? '—'})`
          })
          .join(
            ', '
          )}. Left out of \`npm run quick\` and hidden behind the compose \`long\` profile, so nothing starts one by accident.\n`

  const suiteSection = artifacts
    .map((artifact) => {
      const scenarios = artifact.scenarios
        .map((scenario) => {
          const type = maybeScenarioType(scenario.typeId)
          return `  - \`${scenario.key}\` — ${mdCell(type?.label ?? 'Custom')}: ${mdCell(
            scenario.description || type?.summary || ''
          )}`
        })
        .join('\n')
      return `- **\`scripts/${artifact.fileName}\`** — ${mdCell(artifact.name)} (${
        artifact.scenarios.length
      } scenario${artifact.scenarios.length === 1 ? '' : 's'}, ${
        artifact.execution === 'all-together' ? 'run together' : 'run one at a time'
      })\n${scenarios}`
    })
    .join('\n')

  return `# ${meta.name || 'Performance Tests'}

${meta.description || 'k6 performance test suites generated by K6 Studio Builder.'}

## Layout

\`\`\`
${slugify(meta.name)}/
├── scripts/          # one k6 script per suite, each holding several scenarios
├── shared/           # config + helpers reused across every suite
├── environments/     # per-environment variable presets
├── examples/         # copy-paste starting points
├── package.json      # npm run <scenario> shortcuts, plus all / quick
├── Dockerfile        # run any scenario in the official k6 image
├── docker-compose.yml
├── run.sh            # run every scenario in the recommended order
└── README.md
\`\`\`

## Prerequisites

Install the latest stable k6: <https://grafana.com/docs/k6/latest/set-up/install-k6/>

## Suites and scenarios

Each script declares its workloads in \`options.scenarios\`. Scenarios that are
alternatives over the same journey are selected at run time with
\`-e SCENARIO=<name>\`; nothing needs to be edited to switch between them.

${suiteSection}

| Command | Scenario | Type | Answers | Typical duration |
| ------- | -------- | ---- | ------- | ---------------- |
${scenarioRows}

**Recommended order:** ${runOrder}

Cheap gates run first, so a broken build fails in a minute instead of hours.
\`run.sh\` and \`npm run all\` already follow this order.
${longNote}
## Run

\`\`\`bash
# one scenario at a time, in the recommended order
${scenarioCommands}

# every scenario (npm scripts are named after them)
npm run all
${hasQuick ? '\n# every scenario except the multi-hour ones\nnpm run quick\n' : ''}
# every scenario (shell)
./run.sh
${long.length > 0 ? 'SKIP_LONG=1 ./run.sh   # …without the multi-hour ones\n' : ''}
# against another environment
k6 run -e BASE_URL=https://staging.example.com ${runs[0] === undefined ? 'scripts/suite.js' : runArgs(runs[0])}

# in Docker, no local k6 needed
docker build -t perf-tests . && docker run --rm perf-tests run ${
    runs[0] === undefined ? 'scripts/suite.js' : runArgs(runs[0])
  }
\`\`\`

## Grafana Cloud k6

\`\`\`bash
k6 cloud login
k6 cloud run ${runs[0] === undefined ? 'scripts/suite.js' : runArgs(runs[0])}
\`\`\`
`
}

function exampleScript(): string {
  return `import http from 'k6/http'
import { sleep } from 'k6'
import { BASE_URL, commonThresholds } from '../shared/config.js'
import { expectOk } from '../shared/helpers.js'

// A minimal starting point. Copy it into scripts/ and grow it,
// or design visually in K6 Studio Builder and re-export.
export const options = {
  vus: 5,
  duration: '30s',
  thresholds: commonThresholds
}

export default function () {
  const res = http.get(\`\${BASE_URL}/health\`)
  expectOk(res, 'health')
  sleep(1)
}
`
}

/* ------------------------------------------------------------------ */
/* ZIP builders                                                        */
/* ------------------------------------------------------------------ */

/** Full project export: every suite plus a maintained-repo scaffold. */
export async function buildProjectZip(
  meta: ProjectMeta,
  artifacts: SuiteArtifact[],
  projectJson: ProjectExport
): Promise<Blob> {
  const zip = new JSZip()

  for (const artifact of artifacts) {
    zip.file(`scripts/${artifact.fileName}`, artifact.script)
  }

  zip.file('shared/config.js', sharedConfig(meta))
  zip.file('shared/helpers.js', sharedHelpers())

  zip.file('environments/staging.json', environmentFile('staging', meta, artifacts))
  zip.file('environments/production.json', environmentFile('production', meta, artifacts))

  zip.file('examples/example.js', exampleScript())
  zip.file('package.json', packageJson(meta, artifacts))
  zip.file('Dockerfile', dockerfile(scenarioRuns(artifacts)[0]))
  zip.file('docker-compose.yml', dockerCompose(artifacts))
  zip.file('run.sh', runScript(artifacts))
  zip.file('.gitignore', gitignore())
  const firstPlan = inRunOrder(artifacts)[0]?.plan
  if (firstPlan !== undefined) zip.file('cloud-config.json', buildCloudConfig(firstPlan))
  zip.file('README.md', projectReadme(meta, artifacts))
  zip.file('project.json', JSON.stringify(projectJson, null, 2))

  return zip.generateAsync({ type: 'blob' })
}

/** Single-suite export: the script + a short README + cloud config. */
export async function buildSuiteZip(meta: ProjectMeta, suite: SuiteArtifact): Promise<Blob> {
  const runs = suiteRuns({ ...suite, fileName: suite.fileName })
  const zip = new JSZip()
  zip.file(suite.fileName, suite.script)
  zip.file('cloud-config.json', buildCloudConfig(suite.plan))

  const scenarioList = suite.scenarios
    .map((scenario) => {
      const type = maybeScenarioType(scenario.typeId)
      return `- **${scenario.name}** — ${type?.label ?? 'Custom'}: ${
        scenario.description || type?.summary || ''
      }${type === undefined ? '' : ` _(${type.approxDuration})_`}`
    })
    .join('\n')

  zip.file(
    'README.md',
    `# ${suite.name}

${suite.description || 'k6 test suite generated by K6 Studio Builder.'}

## Scenarios

${scenarioList}

\`\`\`bash
${runs.map((run) => `k6 run ${run.scenarioKey === null ? '' : `-e SCENARIO=${run.scenarioKey} `}${suite.fileName}`).join('\n')}
\`\`\`
`
  )
  return zip.generateAsync({ type: 'blob' })
}
