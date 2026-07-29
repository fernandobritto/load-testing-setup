# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Project

K6 Studio Builder — a visual, low-code builder for [Grafana k6](https://grafana.com/docs/k6/latest/) load-testing scripts. Next.js 16 (App Router) + React 19 + TypeScript strict + Tailwind 4 + Zustand + React Flow. Entirely client-side: no backend, project state persists to localStorage.

**Mental model:** a project is a _performance test suite_, never a single test. One journey is drawn on the canvas and measured by many **scenarios** — smoke, load, stress, spike, capacity, breakpoint, soak, custom — each with its own executor, ramp, thresholds, tags and env, and each fully isolated from the others.

## Commands

```bash
npm run dev            # dev server (Turbopack) on :3000
npm run build          # production build
npm run lint           # ESLint flat config; `any` is an error
npm run typecheck      # tsc --noEmit
npm run format         # Prettier (no semicolons, single quotes, width 110)
npm test               # vitest run — all unit tests
npm test -- lib/curl/parse.test.ts        # single test file
npm test -- -t 'parses multipart'         # tests matching a name
```

Vitest only picks up `lib/**/*.test.ts` and `stores/**/*.test.ts` (node environment — no component tests). Husky runs lint-staged on pre-commit and commitlint (Conventional Commits) on commit-msg.

**k6 binary smoke test:** `K6_SMOKE_OUT=<dir> npm test` additionally writes `kitchen-sink.js` (every generator feature, multi-scenario), `quick.js` (fast variant) and `mixed.js` (`all-together` execution) to `<dir>` for manual verification with a real k6 binary — `k6 inspect <file>` proves the options parse and shows which scenarios the `-e SCENARIO=` gate resolves; `k6 run <dir>/quick.js` executes. Skipped when the env var is unset.

## Architecture

Core rule: **the canvas is never translated to JavaScript directly** — everything flows through a typed intermediate model, and code is emitted from a JS AST, never by string templating.

```
Suite canvas ──▶ compileFlow() ──▶ TestPlan (DSL) ──▶ validatePlan() ──▶ generateProgram() ──▶ printProgram() ──▶ <suite>.js
 (nodes/edges)    lib/flow           lib/dsl            lib/validation       JS AST (lib/codegen)      no-semicolon printer
```

A **suite** is one exported script: a journey plus the scenarios measuring it. Scenarios are `scenario` nodes on the canvas and normally all point at the same first step — that shared wiring is what makes one journey testable as every load shape without duplication. Suites exist for _different journeys_ (checkout API vs. search API), not different load shapes. Each compiles and validates independently via `buildSuite()` in `lib/export/build.ts`; `lib/export/exporters.ts` assembles the per-suite/project ZIP artifacts and derives every runnable command with `scenarioRuns()`, ordered cheapest-gate-first.

Three invariants the whole pipeline depends on:

1. **Scenario isolation.** A scenario's thresholds live on the `ScenarioDef`, not on the canvas, and are emitted with k6's tag selector — `http_req_duration{scenario:smoke}`. Suite-wide gates remain `threshold` nodes. Nothing a scenario owns can affect another.
2. **Shared journeys emit once.** `planScenarios()` in `lib/codegen/generate.ts` fingerprints each scenario's steps (ids excluded) and collapses matching journeys onto one exported function that every scenario `exec`s — the shape [k6 documents](https://grafana.com/docs/k6/latest/using-k6/scenarios/advanced-examples/). A single scenario keeps `export default function`.
3. **One source of truth for "what gets emitted".** `lib/dsl/plan.ts` (`activeScenarioPlans`, `scopedThresholds`) is used by the generator, the validator and the exporters, so the preview, the validation verdict and the ZIP can never disagree.

k6 has no CLI flag for choosing a scenario ([grafana/k6#2780](https://github.com/grafana/k6/issues/2780)), so a multi-scenario suite emits the documented `__ENV.SCENARIO` selector. `TestPlan.execution` decides its default: `one-at-a-time` (alternatives — defaults to the first scenario) or `all-together` (one combined workload — defaults to `all`).

- `lib/dsl/` — the source of truth: `TestPlan`, `ScenarioDef` (typeId, description, enabled, executor, thresholds, tags, env, scheduling), executors, steps (request, batch, group, sleep, think-time, conditional, loop), checks, thresholds, custom metrics, env vars, shared data. `defaults.ts` holds the factory functions, `plan.ts` the emission queries.
- `lib/flow/` — React Flow node/edge types and the graph→DSL compiler. Scenario nodes are entry points; conditionals fork via `true`/`false` handles, loops via `body`/`next`. `clone.ts` holds the pure canvas helpers: `cloneFlow` (fresh ids, remapped edges/parentIds), `journeyHead` (the step every scenario wires to) and `addScenarioToFlow` (add a workload and connect it to the existing journey).
- `lib/curl/` — shell tokenizer + curl parser with per-command error reporting.
- `lib/validation/` — rule engine producing issues with severity, node reference and suggested fix; includes a syntax smoke-test of the generated script. Export is disabled while errors exist.
- `lib/codegen/` — JS AST (`js-ast.ts`), StandardJS-style printer (`print.ts`), DSL→AST generator (`generate.ts`). Generated scripts must use only documented, current k6 APIs. **Identifier invariant:** every module-scope name (env vars, metrics, shared data, journey functions, file handles) is pre-allocated through one `NameAllocator` _before_ any function body is generated, and `{{placeholders}}` resolve through `currentNameMap` — this is what guarantees no duplicate `const` even when user names collide. Never emit an ad-hoc `toIdentifier()` at statement-emission time.
- `lib/k6/` — k6 knowledge base: executor metadata (properties panels render from it), built-in metric catalog with educational content, `load-profile.ts` (one implementation of a scenario's shape/duration/peak, shared by the chart, the cards and the timeline), and `scenario-types.ts` — the data-driven scenario catalogue plus curated `SCENARIO_BUNDLES`. Type metadata (`order`, `approxDuration`, `longRunning`, `answers`, `watchFor`, `summary`, `color`) drives the picker, the cards, the timeline, the coverage panel, run order and the generated README; a new type declares all of it and no UI switches on the id.
- `stores/` — Zustand: `project-store.ts` (persisted, undo/redo history, clipboard) and `auth-store.ts`. Persistence is `version: 3`; `migrateSuiteToScenarios` upgrades v1 (single top-level canvas) and v2 (one test type per suite, `presetHint` + `fromPreset` threshold nodes) — the same function backs localStorage rehydration and JSON imports (`normalizeProjectImport`/`normalizeSuiteImport`), so any schema change needs a version bump plus that migration extended, never a breaking rewrite. Persisted stores gate rendering until after mount to avoid hydration mismatches. **Selectors must return stable references** — `scenarioNodesOf()` allocates, so components call it inside `useMemo` keyed on the nodes array rather than through a selector (an unstable selector makes `useSyncExternalStore` loop forever).
- `components/` — feature-first: `step1/` (import), `step2/` (canvas builder), `step3/` (export/review), shared `ui/` kit on Radix primitives, `theme/` (5 themes). In `step2/`, `scenario-panel.tsx` is the Scenario Builder (cards, DnD, enable/disable, execution mode), `scenario-library-dialog.tsx` adds workloads and `scenario-timeline.tsx` shows how they relate in time.
- `{{NAME}}` placeholders in request fields resolve to env vars (`__ENV.NAME`) or values extracted from earlier responses.

### Adding features

Each layer keeps its logic in a single, isolated `switch` case — extend all layers, none translates for another:

- **Executor option:** `ExecutorConfig` in `lib/dsl/types.ts` → metadata in `lib/k6/executors.ts` → `executorProps()` in `lib/codegen/generate.ts` → `validateExecutor()`.
- **Step/node type:** DSL step union → node data + palette entry (`lib/flow/types.ts`, `components/step2/flow-nodes.tsx`) → `compileFlow()` case → properties panel section → `stepStmts()` case in the generator → validator rules.
- **Metric education:** `BUILTIN_METRICS` in `lib/k6/metrics.ts`.
- **Scenario type:** `ScenarioTypeId` in `lib/dsl/types.ts` → entry in `SCENARIO_TYPES` (`lib/k6/scenario-types.ts`) → a `--type-<id>` colour in `app/globals.css` → an icon key in `components/shared/scenario-type-icon.tsx`. Nothing else.
