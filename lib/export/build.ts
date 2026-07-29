import { generateScript, scenarioKey } from '@/lib/codegen/generate'
import { activeScenarioPlans } from '@/lib/dsl/plan'
import type { TestPlan } from '@/lib/dsl/types'
import { compileFlow } from '@/lib/flow/compile'
import { validatePlan, type ValidationResult } from '@/lib/validation/engine'
import type { ProjectMeta, Suite } from '@/stores/project-store'
import { suiteFileName, type ScenarioArtifact, type SuiteArtifact } from './exporters'

export interface SuiteBuild {
  suite: Suite
  plan: TestPlan
  validation: ValidationResult
  orphanNodeIds: Set<string>
  script: string
  scriptError: string | null
}

/** Compiles, validates and generates the script for a single suite. */
export function buildSuite(meta: ProjectMeta, suite: Suite): SuiteBuild {
  /* The suite's name/description drive the generated script's header. */
  const suiteMeta: ProjectMeta = {
    name: suite.name || meta.name,
    description: suite.description || meta.description,
    baseUrl: meta.baseUrl
  }
  const { plan, orphanNodeIds } = compileFlow({
    meta: suiteMeta,
    options: suite.options,
    execution: suite.execution,
    nodes: suite.nodes,
    edges: suite.edges
  })
  const validation = validatePlan(plan)

  let script = ''
  let scriptError: string | null = null
  try {
    script = generateScript(plan)
  } catch (error) {
    scriptError = error instanceof Error ? error.message : 'unknown error'
    script = `// Script generation failed: ${scriptError}\n// Fix the validation errors in the builder and re-export.`
  }

  return { suite, plan, validation, orphanNodeIds: new Set(orphanNodeIds), script, scriptError }
}

/** Builds every suite and assigns unique file names for export. */
export function buildAllSuites(meta: ProjectMeta, suites: Suite[]): SuiteBuild[] {
  return suites.map((suite) => buildSuite(meta, suite))
}

/**
 * The scenarios a generated script actually contains, in canvas order, keyed the
 * same way the script keys them — so `-e SCENARIO=<key>` in the docs, npm
 * scripts and compose services always names a scenario that exists.
 */
export function scenarioArtifacts(plan: TestPlan): ScenarioArtifact[] {
  return activeScenarioPlans(plan).map(({ scenario }) => ({
    key: scenarioKey(scenario.name),
    name: scenario.name,
    typeId: scenario.typeId,
    description: scenario.description
  }))
}

/** Turns suite builds into export artifacts with unique file names. */
export function toArtifacts(builds: SuiteBuild[]): SuiteArtifact[] {
  const taken = new Set<string>()
  return builds.map((build) => ({
    id: build.suite.id,
    name: build.suite.name,
    description: build.suite.description,
    execution: build.plan.execution,
    scenarios: scenarioArtifacts(build.plan),
    fileName: suiteFileName(build.suite.name, taken),
    plan: build.plan,
    script: build.script
  }))
}
