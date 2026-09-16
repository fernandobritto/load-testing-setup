'use client'

import { AnimatePresence, motion } from 'framer-motion'
import dynamic from 'next/dynamic'
import {
  AlertTriangle,
  BookOpen,
  Check,
  CheckCircle2,
  Cloud,
  Copy,
  Download,
  FileArchive,
  FileCode2,
  FileJson,
  Folder,
  GraduationCap,
  Layers,
  ShieldCheck,
  ShieldAlert,
  XCircle
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { monacoThemeFor, useTheme } from '@/components/theme/theme-provider'
import { RampChart } from '@/components/shared/ramp-chart'
import { ScenarioTypeIcon, scenarioTypeColor } from '@/components/shared/scenario-type-icon'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { scenarioKey } from '@/lib/codegen/generate'
import { scopedThresholds } from '@/lib/dsl/plan'
import { toArtifacts, type SuiteBuild } from '@/lib/export/build'
import {
  buildCloudConfig,
  buildProjectZip,
  buildSuiteZip,
  downloadBlob,
  downloadText,
  scenarioRuns,
  slugify,
  type SuiteArtifact
} from '@/lib/export/exporters'
import { CONCEPTS } from '@/lib/k6/education'
import { BUILTIN_METRICS, builtinMetric, type MetricEducation } from '@/lib/k6/metrics'
import { maybeScenarioType, SCENARIO_TYPES_IN_ORDER, type ScenarioTypeId } from '@/lib/k6/scenario-types'
import { cn } from '@/lib/utils'
import { useProjectStore } from '@/stores/project-store'

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => (
    <div className='flex h-full items-center justify-center text-sm text-muted-foreground'>
      Loading editor…
    </div>
  )
})

const EDUCATION_SECTIONS: Array<{ key: keyof MetricEducation; label: string }> = [
  { key: 'measures', label: 'What it measures' },
  { key: 'whyItMatters', label: 'Why it matters' },
  { key: 'slaRecommendation', label: 'Typical SLA' },
  { key: 'sloRecommendation', label: 'SLO recommendation' },
  { key: 'bestPractices', label: 'Best practices' },
  { key: 'pitfalls', label: 'Common pitfalls' },
  { key: 'interpretation', label: 'How to interpret' }
]

interface StepReviewProps {
  builds: SuiteBuild[]
  allValid: boolean
}

export function StepReview({ builds, allValid }: StepReviewProps): React.ReactNode {
  const meta = useProjectStore((state) => state.meta)
  const activeSuiteId = useProjectStore((state) => state.activeSuiteId)
  const exportProject = useProjectStore((state) => state.exportProject)
  const { theme } = useTheme()
  const [copied, setCopied] = useState(false)

  const artifacts = useMemo(() => toArtifacts(builds), [builds])
  const [selectedId, setSelectedId] = useState(activeSuiteId)

  const selectedIndex = Math.max(
    0,
    builds.findIndex((build) => build.suite.id === selectedId)
  )
  const build = builds[selectedIndex] ?? builds[0]
  const artifact = artifacts[selectedIndex] ?? artifacts[0]
  const plan = build.plan
  const script = build.script

  /** Every gate the suite emits, suite-wide and per scenario. */
  const gates = useMemo(() => scopedThresholds(plan), [plan])

  const configuredMetrics = useMemo(() => {
    const names = new Set<string>([
      'http_req_duration',
      'http_req_failed',
      'http_reqs',
      'checks',
      'vus',
      'iterations'
    ])
    for (const gate of gates) names.add(gate.threshold.metric)
    return BUILTIN_METRICS.filter((metric) => names.has(metric.name))
  }, [gates])

  const totalWarnings = builds.reduce((sum, entry) => sum + entry.validation.warnings.length, 0)
  const fileBase = slugify(meta.name)

  const copyScript = async (): Promise<void> => {
    await navigator.clipboard.writeText(script)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  const downloadProjectZip = (): void => {
    void buildProjectZip(meta, artifacts, exportProject()).then((blob) =>
      downloadBlob(blob, `${fileBase}.zip`)
    )
  }
  const downloadSuiteZip = (): void => {
    void buildSuiteZip(meta, artifact).then((blob) => downloadBlob(blob, `${slugify(artifact.name)}.zip`))
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      {/* Export bar */}
      <div className='flex flex-wrap items-center gap-2 border-b border-border bg-card px-5 py-3'>
        <h2 className='mr-1 text-base font-semibold'>Review &amp; export</h2>

        {allValid ? (
          <Badge variant='success'>
            <Check className='size-3' aria-hidden />
            {builds.length} suite{builds.length === 1 ? '' : 's'} ready for the latest stable k6
          </Badge>
        ) : (
          <Badge variant='destructive'>
            <XCircle className='size-3' aria-hidden />
            {builds.filter((entry) => !entry.validation.valid).length} suite(s) have errors — project export
            disabled
          </Badge>
        )}
        {totalWarnings > 0 && (
          <Badge variant='warning'>
            <AlertTriangle className='size-3' aria-hidden />
            {totalWarnings} warning{totalWarnings === 1 ? '' : 's'}
          </Badge>
        )}

        <div className='ml-auto flex flex-wrap items-center gap-1.5'>
          <Button
            variant='outline'
            size='sm'
            onClick={() => void copyScript()}
            disabled={!build.validation.valid}
          >
            {copied ? (
              <Check className='size-3.5 text-success' aria-hidden />
            ) : (
              <Copy className='size-3.5' aria-hidden />
            )}
            {copied ? 'Copied' : 'Copy script'}
          </Button>
          <Button
            variant='outline'
            size='sm'
            onClick={() => downloadText(script, artifact.fileName, 'text/javascript')}
            disabled={!build.validation.valid}
          >
            <Download className='size-3.5' aria-hidden />
            {artifact.fileName}
          </Button>
          <Button variant='outline' size='sm' onClick={downloadSuiteZip} disabled={!build.validation.valid}>
            <FileArchive className='size-3.5' aria-hidden />
            Suite ZIP
          </Button>
          <Button
            variant='outline'
            size='sm'
            onClick={() => downloadText(buildCloudConfig(plan), `${fileBase}.cloud.json`, 'application/json')}
            disabled={!build.validation.valid}
          >
            <Cloud className='size-3.5' aria-hidden />
            Cloud
          </Button>
          <Button
            variant='outline'
            size='sm'
            onClick={() =>
              downloadText(
                JSON.stringify(exportProject(), null, 2),
                `${fileBase}.project.json`,
                'application/json'
              )
            }
          >
            <FileJson className='size-3.5' aria-hidden />
            Project JSON
          </Button>
          <Button size='sm' onClick={downloadProjectZip} disabled={!allValid}>
            <FileArchive className='size-3.5' aria-hidden />
            Download project ZIP
          </Button>
        </div>
      </div>

      {/* Suite selector */}
      <div className='flex items-center gap-1 overflow-x-auto border-b border-border bg-card px-5 py-1.5'>
        {builds.map((entry, index) => (
          <button
            key={entry.suite.id}
            onClick={() => setSelectedId(entry.suite.id)}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors cursor-pointer',
              entry.suite.id === build.suite.id
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
            aria-current={entry.suite.id === build.suite.id}
          >
            {entry.validation.valid ? (
              <CheckCircle2 className='size-3.5 text-success' aria-hidden />
            ) : (
              <XCircle className='size-3.5 text-destructive' aria-hidden />
            )}
            {entry.suite.name}
            <span className='font-mono text-[10px] text-muted-foreground'>{artifacts[index]?.fileName}</span>
          </button>
        ))}
      </div>

      {/* Split screen */}
      <div className='grid min-h-0 flex-1 lg:grid-cols-2'>
        {/* Left: dashboard */}
        <section
          className='min-h-0 overflow-y-auto border-r border-border p-5'
          aria-label='Educational metrics dashboard'
        >
          <ScenarioCoverage artifacts={artifacts} onSelect={(id) => setSelectedId(id)} />

          <FileTree
            artifacts={artifacts}
            selectedName={artifact.fileName}
            onSelect={(id) => setSelectedId(id)}
          />

          {/* Workloads: shape and gates, per scenario */}
          {plan.scenarios.length > 0 && (
            <div className='mb-5'>
              <h3 className='mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold'>
                Workloads in this suite
                <Badge variant='outline'>
                  {plan.execution === 'all-together' ? 'run together' : 'one per run'}
                </Badge>
              </h3>
              <div className='grid gap-3 sm:grid-cols-2'>
                {plan.scenarios.map(({ scenario }) => {
                  const color = scenarioTypeColor(scenario.typeId)
                  return (
                    <div
                      key={scenario.id}
                      className={cn(
                        'space-y-1 rounded-lg border border-border p-2',
                        !scenario.enabled && 'opacity-50'
                      )}
                    >
                      <p className='flex items-center gap-1.5 text-xs font-medium'>
                        <span style={{ color }}>
                          <ScenarioTypeIcon typeId={scenario.typeId} className='size-3.5' />
                        </span>
                        <span className='min-w-0 flex-1 truncate font-mono'>{scenario.name}</span>
                        {!scenario.enabled && <Badge variant='secondary'>disabled</Badge>}
                      </p>
                      <RampChart config={scenario.executor} height={80} color={color} />
                      {scenario.thresholds.length > 0 && (
                        <ul className='space-y-0.5'>
                          {scenario.thresholds.map((threshold) => (
                            <li
                              key={threshold.id}
                              className='truncate font-mono text-[10px] text-muted-foreground'
                            >
                              <span style={{ color }}>▸</span> {threshold.metric}: {threshold.aggregation}
                              {threshold.operator}
                              {threshold.value}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Quality gates */}
          <div className='mb-5'>
            <h3 className='mb-2 flex items-center gap-2 text-sm font-semibold'>
              <ShieldCheck className='size-4 text-primary' aria-hidden />
              Quality gates
            </h3>
            {gates.length === 0 ? (
              <div className='flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs'>
                <ShieldAlert className='mt-0.5 size-4 shrink-0 text-warning' aria-hidden />
                <span>
                  No thresholds — this suite can never fail automatically. Add a threshold (e.g.{' '}
                  <code className='font-mono'>http_req_duration p(95)&lt;500</code>) so CI catches
                  regressions.
                </span>
              </div>
            ) : (
              <ul className='space-y-1'>
                {gates.map(({ threshold, scenarioId }) => {
                  const owner = plan.scenarios.find((entry) => entry.scenario.id === scenarioId)?.scenario
                  return (
                    <li
                      key={`${scenarioId ?? 'suite'}-${threshold.id}`}
                      className='flex flex-wrap items-center gap-2 rounded-md bg-muted/50 px-2.5 py-1.5 font-mono text-xs'
                    >
                      <span className='text-primary'>▸</span>
                      {threshold.metric}
                      {owner !== undefined && (
                        <span className='text-muted-foreground'>{`{scenario:${scenarioKey(owner.name)}}`}</span>
                      )}
                      : {threshold.aggregation}
                      {threshold.operator}
                      {threshold.value}
                      {owner === undefined && <Badge variant='outline'>suite-wide</Badge>}
                      {threshold.abortOnFail && <Badge variant='destructive'>abort on fail</Badge>}
                      {builtinMetric(threshold.metric) === undefined && (
                        <Badge variant='secondary'>custom</Badge>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {/* Metric cards */}
          <div className='mb-3 flex items-center gap-2'>
            <GraduationCap className='size-4 text-primary' aria-hidden />
            <h3 className='text-sm font-semibold'>Metrics in this suite — what they mean</h3>
          </div>
          <div className='mb-4 grid gap-2 sm:grid-cols-2'>
            {configuredMetrics.map((metric) => {
              const gated = plan.thresholds.some((threshold) => threshold.metric === metric.name)
              return (
                <div key={metric.name} className='rounded-lg border border-border bg-card p-3'>
                  <div className='flex items-center justify-between gap-2'>
                    <code className='font-mono text-xs font-semibold text-primary'>{metric.name}</code>
                    <Badge variant='outline'>{metric.type}</Badge>
                  </div>
                  <p className='mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground'>
                    {metric.education.measures}
                  </p>
                  <div className='mt-2'>
                    {gated ? (
                      <span className='inline-flex items-center gap-1 text-[10px] font-medium text-success'>
                        <ShieldCheck className='size-3' aria-hidden />
                        SLO gated
                      </span>
                    ) : (
                      <span className='inline-flex items-center gap-1 text-[10px] font-medium text-warning'>
                        <ShieldAlert className='size-3' aria-hidden />
                        no threshold
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          <Accordion type='multiple' defaultValue={[configuredMetrics[0]?.name ?? '']}>
            {configuredMetrics.map((metric) => (
              <AccordionItem key={metric.name} value={metric.name}>
                <AccordionTrigger>
                  <span className='flex items-center gap-2'>
                    <code className='font-mono text-xs text-primary'>{metric.name}</code>
                    {plan.thresholds.some((threshold) => threshold.metric === metric.name) && (
                      <Badge variant='success'>thresholded</Badge>
                    )}
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <p className='mb-3 text-xs leading-relaxed'>{metric.education.description}</p>
                  <dl className='space-y-2'>
                    {EDUCATION_SECTIONS.map((section) => (
                      <div key={section.key} className='rounded-md bg-muted/60 p-2'>
                        <dt className='text-[10px] font-semibold uppercase tracking-wider text-muted-foreground'>
                          {section.label}
                        </dt>
                        <dd className='mt-0.5 text-xs leading-relaxed'>{metric.education[section.key]}</dd>
                      </div>
                    ))}
                  </dl>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>

          <div className='mt-6'>
            <div className='mb-2 flex items-center gap-2'>
              <BookOpen className='size-4 text-primary' aria-hidden />
              <h3 className='text-sm font-semibold'>Performance testing concepts</h3>
            </div>
            <Accordion type='multiple'>
              {CONCEPTS.map((concept) => (
                <AccordionItem key={concept.id} value={concept.id}>
                  <AccordionTrigger className='text-xs'>{concept.question}</AccordionTrigger>
                  <AccordionContent>
                    <p className='text-xs leading-relaxed text-muted-foreground'>{concept.answer}</p>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </section>

        {/* Right: generated code */}
        <section className='flex min-h-64 min-w-0 flex-col' aria-label='Generated k6 script'>
          <div className='flex items-center gap-2 border-b border-border bg-card px-5 py-2.5'>
            <span
              className={cn(
                'size-2.5 rounded-full',
                build.validation.valid ? 'bg-success' : 'bg-destructive'
              )}
              aria-hidden
            />
            <p className='font-mono text-xs text-muted-foreground'>
              scripts/{artifact.fileName} — generated live from {build.suite.name}
            </p>
            <p className='ml-auto font-mono text-[10px] text-muted-foreground'>
              {script.split('\n').length} lines
            </p>
          </div>
          <div className='min-h-0 flex-1'>
            <AnimatePresence mode='wait'>
              <motion.div
                key={build.suite.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.15 }}
                className='h-full'
              >
                <MonacoEditor
                  language='javascript'
                  theme={monacoThemeFor(theme)}
                  value={script}
                  options={{
                    readOnly: true,
                    minimap: { enabled: false },
                    fontSize: 13,
                    lineNumbers: 'on',
                    folding: true,
                    scrollBeyondLastLine: false,
                    wordWrap: 'on',
                    renderLineHighlight: 'none',
                    smoothScrolling: true,
                    padding: { top: 12 }
                  }}
                />
              </motion.div>
            </AnimatePresence>
          </div>
        </section>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Scenario coverage                                                   */
/* ------------------------------------------------------------------ */

/**
 * What the project can actually answer for. A performance repo is judged by the
 * questions it covers, so every scenario — with the exact command that runs it —
 * and the types still missing are worth seeing before the ZIP is downloaded.
 */
function ScenarioCoverage({
  artifacts,
  onSelect
}: {
  artifacts: SuiteArtifact[]
  onSelect: (id: string) => void
}): React.ReactNode {
  const runs = scenarioRuns(artifacts)
  const covered = new Set<ScenarioTypeId>()
  for (const artifact of artifacts) {
    for (const scenario of artifact.scenarios) covered.add(scenario.typeId)
  }
  const missing = SCENARIO_TYPES_IN_ORDER.filter((type) => type.id !== 'custom' && !covered.has(type.id))
  const canonical = SCENARIO_TYPES_IN_ORDER.filter((type) => type.id !== 'custom').length

  return (
    <div className='mb-5 rounded-lg border border-border bg-card p-3'>
      <h3 className='mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold'>
        <Layers className='size-4 text-primary' aria-hidden />
        Scenarios in this project
        <Badge variant='outline'>{runs.length} runnable</Badge>
        <Badge variant='outline'>
          {[...covered].filter((id) => id !== 'custom').length} of {canonical} types
        </Badge>
      </h3>
      <p className='mb-2 text-[11px] leading-relaxed text-muted-foreground'>
        Listed in the order the generated <code className='font-mono'>run.sh</code> executes them: cheap gates
        first, multi-hour runs last.
      </p>
      <ul className='space-y-1'>
        {runs.map((run) => {
          const type = maybeScenarioType(run.scenarios[0]?.typeId)
          return (
            <li key={run.key}>
              <button
                onClick={() => onSelect(run.suite.id)}
                className='flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs transition-colors hover:bg-muted cursor-pointer'
              >
                <span style={{ color: scenarioTypeColor(run.scenarios[0]?.typeId) }}>
                  <ScenarioTypeIcon typeId={run.scenarios[0]?.typeId} className='size-3.5 shrink-0' />
                </span>
                <span className='min-w-0 flex-1 truncate font-medium'>
                  {run.scenarios.length === 1 ? run.scenarios[0].name : run.suite.name}
                </span>
                <code className='shrink-0 rounded bg-muted px-1 font-mono text-[10px] text-muted-foreground'>
                  npm run {run.key}
                </code>
                <span className='shrink-0 text-[10px] text-muted-foreground'>
                  {type?.approxDuration ?? '—'}
                </span>
                {run.longRunning && <Badge variant='warning'>long</Badge>}
              </button>
            </li>
          )
        })}
      </ul>
      {missing.length > 0 && (
        <p className='mt-2 border-t border-border pt-2 text-[11px] leading-relaxed text-muted-foreground'>
          Not covered: {missing.map((type) => type.label).join(', ')}. Add them from{' '}
          <span className='font-medium text-foreground'>Design → Scenarios → Add</span> — they reuse the
          journey you already built.
        </p>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Generated project file tree                                         */
/* ------------------------------------------------------------------ */

function FileTree({
  artifacts,
  selectedName,
  onSelect
}: {
  artifacts: ReturnType<typeof toArtifacts>
  selectedName: string
  onSelect: (id: string) => void
}): React.ReactNode {
  return (
    <div className='mb-5 rounded-lg border border-border bg-card p-3'>
      <h3 className='mb-2 flex items-center gap-2 text-sm font-semibold'>
        <Folder className='size-4 text-primary' aria-hidden />
        Generated project
      </h3>
      <ul className='space-y-0.5 font-mono text-xs'>
        <TreeRow
          depth={0}
          icon={<Folder className='size-3.5 text-muted-foreground' aria-hidden />}
          label='scripts/'
        />
        {artifacts.map((artifact) => (
          <li key={artifact.id}>
            <button
              onClick={() => onSelect(artifact.id)}
              className={cn(
                'flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left transition-colors cursor-pointer',
                artifact.fileName === selectedName ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'
              )}
              style={{ paddingLeft: 20 }}
            >
              <FileCode2 className='size-3.5 text-success' aria-hidden />
              {artifact.fileName}
            </button>
          </li>
        ))}
        <TreeRow
          depth={0}
          icon={<Folder className='size-3.5 text-muted-foreground' aria-hidden />}
          label='shared/'
        />
        <TreeRow depth={1} label='config.js' />
        <TreeRow depth={1} label='helpers.js' />
        <TreeRow
          depth={0}
          icon={<Folder className='size-3.5 text-muted-foreground' aria-hidden />}
          label='environments/'
        />
        <TreeRow depth={1} label='staging.json' />
        <TreeRow depth={1} label='production.json' />
        <TreeRow depth={0} label='package.json' />
        <TreeRow depth={0} label='Dockerfile' />
        <TreeRow depth={0} label='docker-compose.yml' />
        <TreeRow depth={0} label='run.sh' />
        <TreeRow depth={0} label='README.md' />
      </ul>
    </div>
  )
}

function TreeRow({
  depth,
  label,
  icon
}: {
  depth: number
  label: string
  icon?: React.ReactNode
}): React.ReactNode {
  return (
    <li
      className='flex items-center gap-1.5 px-1.5 py-1 text-muted-foreground'
      style={{ paddingLeft: 6 + depth * 14 }}
    >
      {icon ?? <FileCode2 className='size-3.5 opacity-50' aria-hidden />}
      {label}
    </li>
  )
}
