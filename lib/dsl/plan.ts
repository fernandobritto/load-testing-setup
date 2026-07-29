import type { ScenarioPlan, TestPlan, ThresholdDef } from './types'

/**
 * The scenarios that end up in the generated script.
 *
 * Disabling every scenario is a configuration error the validator reports; until
 * it is fixed the whole suite is treated as active so the live preview and the
 * validator agree on what is being judged, instead of showing an empty test.
 */
export function activeScenarioPlans(plan: TestPlan): ScenarioPlan[] {
  const enabled = plan.scenarios.filter((entry) => entry.scenario.enabled)
  return enabled.length > 0 ? enabled : plan.scenarios
}

/** A quality gate together with the scenario it is scoped to (null = suite-wide). */
export interface ScopedThreshold {
  threshold: ThresholdDef
  scenarioId: string | null
}

/** Every gate the plan will emit: suite-wide first, then per active scenario. */
export function scopedThresholds(plan: TestPlan): ScopedThreshold[] {
  return [
    ...plan.thresholds.map((threshold) => ({ threshold, scenarioId: null })),
    ...activeScenarioPlans(plan).flatMap((entry) =>
      entry.scenario.thresholds.map((threshold) => ({ threshold, scenarioId: entry.scenario.id }))
    )
  ]
}

/** Gates that judge a given scenario: its own plus every suite-wide one. */
export function thresholdsForScenario(plan: TestPlan, scenarioId: string): ThresholdDef[] {
  const scenario = plan.scenarios.find((entry) => entry.scenario.id === scenarioId)
  return [...plan.thresholds, ...(scenario?.scenario.thresholds ?? [])]
}
