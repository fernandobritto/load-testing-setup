# K6 Studio Builder

A visual **K6 script builder and load test designer** — a low-code, drag & drop platform for creating
production-ready [Grafana k6](https://grafana.com/docs/k6/latest/) load testing scripts without writing
JavaScript by hand.

Import cURL commands, draw the user journey once on an infinite canvas, then measure it with a whole
**suite of performance scenarios** — smoke, load, stress, spike, capacity, breakpoint, soak, custom —
each with its own executor, ramp and quality gates. Validate everything, learn what each metric means,
and export a script that runs on the latest stable k6 with zero manual edits.

![Stack](https://img.shields.io/badge/Next.js-16-black) ![React](https://img.shields.io/badge/React-19-blue) ![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue) ![k6](https://img.shields.io/badge/k6-latest%20stable-7d64ff)

---

## Features

- **A project is a performance test suite, not a single test** — the **Scenario Builder** holds as many
  workloads as the suite needs to answer for: add, remove, duplicate, rename, reorder (drag), collapse and
  enable/disable them without deleting. Pick types individually or take a curated combination (Essentials,
  Release gate, Capacity planning, Resilience, Full sweep). Every scenario owns its executor, ramp,
  thresholds, tags, environment and description, and **changing one never touches another** — in the
  builder or in the generated script.
- **Scenarios share the journey, not the maintenance** — wire the requests once and every scenario
  measures them. The generated script exports the journey as a single function that all scenarios `exec`,
  which is exactly the shape [k6 documents](https://grafana.com/docs/k6/latest/using-k6/scenarios/advanced-examples/)
  for the case. Add a stress test to a project and nothing is duplicated.
- **Per-scenario quality gates** — a scenario's thresholds are emitted with k6's tag selector
  (`http_req_duration{scenario:smoke}`), so a smoke gate can never fail because the stress scenario was
  slow. Suite-wide gates still exist as threshold nodes on the canvas.
- **Run one workload or all of them** — a suite of alternatives runs one scenario per invocation
  (`k6 run -e SCENARIO=stress suite.js`, defaulting to the cheapest gate) because starting a four-hour
  soak next to a smoke test measures neither; a combined workload runs every scenario in the same test,
  sequenced by `startTime`. Switch with one control; the generated script, npm scripts, compose services,
  `run.sh` and README all follow.
- **Suite timeline** — every workload on one axis: real test clock when they run together (so overlap and
  `startTime` are visible), comparable bars when they are alternatives.
- **Three-step guided wizard** — Import → Design → Export.
- **cURL importer** — paste one or many commands (multi-line, `;`, `&&`, `\` continuations); the parser
  extracts method, URL, query params, headers, cookies, auth, JSON / form / multipart bodies, and reports
  actionable errors for anything invalid.
- **Visual builder (React Flow)** — infinite canvas with drag & drop, connect, multi-select, copy/paste,
  duplicate, undo/redo, snap grid, minimap, auto-layout, fullscreen.
- **All official k6 executors** — `shared-iterations`, `per-vu-iterations`, `constant-vus`, `ramping-vus`,
  `constant-arrival-rate`, `ramping-arrival-rate`, `externally-controlled` — each exposing its documented
  options.
- **Scenario templates** — Smoke, Load, Stress, Spike, Capacity, Breakpoint, Soak and Custom, each with
  industry-standard executor, ramp, thresholds and metric tags, plus the question it answers, what to watch
  for in the results and its typical duration. Adding a type is a data change: nothing in the UI switches
  on an id.
- **Flow components** — groups, sleep, randomized think time, conditional branches, loops, parallel
  `http.batch`, sequential chains, setup/teardown lifecycle.
- **Validation engine** — executors, scenarios, thresholds, checks, metrics, env vars, HTTP config,
  placeholder references and generated-JS syntax are all verified; export stays disabled and offending
  nodes are highlighted until the model is valid.
- **Educational dashboard** — every metric explains what it measures, why it matters, SLA/SLO
  recommendations, best practices, pitfalls and interpretation guidance.
- **Live code generation** — the k6 script is generated from an internal DSL/AST (never string
  concatenation) and shown live in Monaco.
- **Exports** — copy a suite's script, download `<suite>.js`, per-suite ZIP, a full **project ZIP**
  laid out like a maintained repo (`scripts/` one file per suite, `shared/config.js` +
  `shared/helpers.js`, `environments/` with every suite's env vars merged, `examples/`, `package.json` with
  a script per **scenario** plus `all` / `quick` chains, `Dockerfile` + `docker-compose.yml`, `run.sh`,
  `README.md` documenting every scenario and the command that runs it), Grafana Cloud k6 config, and
  re-importable project/suite JSON. Everything runs cheapest-gate-first; multi-hour scenarios (Soak,
  Breakpoint) are ordered last, excluded from `quick`, and kept behind the compose `long` profile so
  nothing starts a four-hour run by accident.
- **Five themes** — Light, Dark, Dracula, JavaScript (black & yellow), Aurora — switchable instantly.

## Getting started

Requirements: **Node.js ≥ 20.9**.

```bash
npm install
npm run dev
```

Open <http://localhost:3000> and sign in with your K6 Studio credentials.

### Scripts

| Command             | What it does                                    |
| ------------------- | ----------------------------------------------- |
| `npm run dev`       | Development server (Turbopack)                  |
| `npm run build`     | Production build                                |
| `npm start`         | Serve the production build                      |
| `npm run lint`      | ESLint (flat config, `any` forbidden)           |
| `npm run format`    | Prettier (no semicolons, single quotes)         |
| `npm run typecheck` | `tsc --noEmit` in strict mode                   |
| `npm test`          | Vitest unit tests (parser, codegen, validation) |
| `npm run validate`  | Format, lint, types, tests and production build |

Husky + lint-staged run ESLint/Prettier on staged files; Commitlint enforces
[Conventional Commits](https://www.conventionalcommits.org/), and the pre-push hook runs the full
validation command.

## Using the app

1. **Step 1 — Import.** Name the project, optionally set a global base URL (matching request URLs are
   rewritten to `${BASE_URL}` overridable via `k6 run -e BASE_URL=…`), and paste cURL commands. Parsed
   requests appear in the library where they can be renamed, edited, reordered, duplicated, grouped and
   deleted.
2. **Step 2 — Design.** Draw the journey first: chain your imported requests after the scenario node by
   connecting node handles, and drag flow, validation and runtime components from the sidebar. Select any
   node to edit every option in the right panel. Suite options (user agent, TLS, DNS, redirects, tags…)
   live in the panel when nothing is selected. The status bar lists every validation issue — click one to
   jump to the node.

   Then build the suite in the **Scenarios** panel: **Add** opens the library — tick the workloads you need
   (or take a combination) and each arrives configured and wired to the journey already on the canvas.
   Select a card to configure that workload alone: executor, ramp, thresholds, tags, environment,
   scheduling. Toggle one off to keep it without exporting it, drag to reorder, and switch between
   **One at a time** and **All together** to say whether the scenarios are alternatives or one combined
   workload. The timeline above the canvas shows how they relate in time.

3. **Step 3 — Export.** Review the scenario coverage and educational metrics dashboard on the left and the
   live-generated script on the right, then copy/download it. Export is disabled while validation errors
   exist.

Run the exported script:

```bash
k6 run script.js                      # the first scenario (cheapest gate)
k6 run -e SCENARIO=stress script.js   # one specific scenario
k6 run -e SCENARIO=all script.js      # every scenario in a single test
# or against another environment:
k6 run -e BASE_URL=https://staging.example.com script.js
```

### Placeholders

Any request field can reference variables with `{{NAME}}`:

- **Environment variables** (env-var nodes) become `const NAME = __ENV.NAME || 'default'`.
- **Extracted values** (request → “Extract variables”) capture JSON fields, headers or the status of a
  response into a const usable by later steps — e.g. extract `authToken` from a login response, then use
  `{{authToken}}` in a Bearer auth field.

## Architecture

The core rule: **the visual canvas is never translated to JavaScript directly.** Everything flows
through a typed intermediate model:

```
Suite canvas ──▶ compileFlow() ──▶ TestPlan (DSL) ──▶ validatePlan() ──▶ generateProgram() ──▶ printProgram() ──▶ <suite>.js
 (nodes/edges)    lib/flow           lib/dsl            lib/validation       JS AST (lib/codegen)      no-semicolon printer
```

A **suite** is one exported script: a journey drawn on a canvas plus the **scenarios** that measure it.
Each scenario is a `scenario` node carrying its own executor, ramp, thresholds, tags, environment and
enabled flag, and several scenarios normally point at the same first step — that is what makes one journey
measurable as smoke, load, stress and soak without duplicating anything. Suites exist for _different
journeys_, not different load shapes; each is compiled and validated independently
(`lib/export/build.ts`) and the project ZIP is assembled from every valid suite
(`lib/export/exporters.ts`, which orders every runnable scenario cheapest-gate-first via
`scenarioRuns()`).

The generator collapses scenarios that share a journey onto a single exported function they all `exec`,
and emits each scenario's gates with k6's tag selector (`http_req_duration{scenario:smoke}`) so no
scenario can fail another's threshold. When a suite holds more than one scenario it also emits the
scenario selector k6 documents — `options.scenarios` built from `__ENV.SCENARIO` — because k6 has no CLI
flag for choosing a workload.

- `lib/dsl/` — the DSL: `TestPlan`, scenarios (type, ramp, gates, tags, env, enabled), executors, steps
  (request, batch, group, sleep, think-time, conditional, loop), checks, thresholds, metrics, env vars,
  shared data. `plan.ts` answers which scenarios and gates a plan actually emits — the single source of
  truth shared by the generator, the validator and the exporters.
- `lib/flow/` — React Flow node/edge typing, the graph→DSL compiler (scenario nodes are entry
  points; groups are containers; conditionals fork via `true`/`false` handles; loops via `body`/`next`)
  and `clone.ts`, the pure canvas helpers behind multi-scenario suites: `cloneFlow`, `journeyHead` and
  `addScenarioToFlow`, which wires a new workload to the journey already on the canvas.
- `lib/curl/` — shell tokenizer + curl argument parser with per-command error reporting.
- `lib/validation/` — rule-based engine producing issues with severity, node reference and suggested
  fix; includes a syntax smoke-test of the generated script.
- `lib/codegen/` — a small JavaScript AST (`js-ast.ts`), a StandardJS-style printer (`print.ts`) and
  the DSL→AST generator (`generate.ts`). No string templating of code, ever.
- `lib/k6/` — the k6 knowledge base: executor metadata, built-in metric catalog with educational
  content, the scenario-type catalogue (`scenario-types.ts`), load profiles, concept explanations.
- `stores/` — Zustand stores: project (persisted to localStorage, with undo/redo history and
  clipboard) and auth.
- `components/` — feature-first React components (`step1/`, `step2/`, `step3/`, shared `ui/` kit built
  on Radix primitives, theme system).

### Folder structure

```
app/                    Next.js App Router pages (login, studio wizard)
components/
  ui/                   shadcn-style primitives (button, dialog, tabs, …)
  theme/                5-theme provider + switcher
  shared/               request editor, key-value editor, ramp chart, scenario type icon
  step1|step2|step3/    wizard features
lib/
  dsl/  flow/  curl/  codegen/  validation/  k6/  export/
stores/                 zustand stores
```

## Extending

- **New k6 executor option** — add it to `ExecutorConfig` (`lib/dsl/types.ts`), describe it in
  `lib/k6/executors.ts` (the properties panel renders from this metadata), emit it in
  `executorProps()` (`lib/codegen/generate.ts`) and validate it in `validateExecutor()`.
- **New step/node type** — add the step to the DSL union, a node data type + palette entry
  (`lib/flow/types.ts`, `components/step2/flow-nodes.tsx`), a case in `compileFlow()`, a properties
  panel section, a `stepStmts()` case in the generator and rules in the validator. Each layer is a
  single, isolated `switch` case.
- **New metric education** — append to `BUILTIN_METRICS` in `lib/k6/metrics.ts`.
- **New scenario type** — add the id to `ScenarioTypeId` (`lib/dsl/types.ts`) and append an entry to
  `SCENARIO_TYPES` in `lib/k6/scenario-types.ts`. Besides the executor, thresholds and tags it must declare
  `order` (campaign position, drives run order), `approxDuration`, `longRunning` (hours-long types are
  excluded from `npm run quick` and the default compose profile), `answers`, `watchFor`, `summary` and a
  `--type-<id>` colour in `app/globals.css`. Nothing else changes: the library picker, the scenario cards,
  the timeline, the coverage panel and the generated README all render from that metadata.
- **New scenario combination** — append to `SCENARIO_BUNDLES` in `lib/k6/scenario-types.ts`; it appears in
  the **Add scenarios** picker with no other change.

## Quality gates

- TypeScript **strict**, zero `any`.
- Unit tests for the cURL parser, code generator (shared journeys, scoped gates, scenario selection),
  validation engine, canvas helpers and the multi-scenario project export (`npm test`).
- Generated scripts use only documented, current k6 APIs (`k6/http`, `k6`, `k6/metrics`, `k6/data`,
  `k6/encoding`) and modern ES module syntax.
- WCAG 2.2 AA: keyboard-accessible controls, focus-visible outlines, ARIA labels, reduced-motion
  support.
