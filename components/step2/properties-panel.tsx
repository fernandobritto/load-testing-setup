'use client'

import { HelpCircle, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { KeyValueEditor } from '@/components/shared/key-value-editor'
import { RampChart } from '@/components/shared/ramp-chart'
import { RequestEditor } from '@/components/shared/request-editor'
import { ScenarioTypeIcon, scenarioTypeColor } from '@/components/shared/scenario-type-icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { createCheck, createStage, createThreshold } from '@/lib/dsl/defaults'
import type {
  CheckDef,
  CheckKind,
  CustomMetricDef,
  EnvVarDef,
  ExecutorConfig,
  ExecutorType,
  ExtractorDef,
  GlobalOptions,
  MetricType,
  ScenarioDef,
  SharedDataDef,
  ThresholdAggregation,
  ThresholdDef,
  ThresholdOperator
} from '@/lib/dsl/types'
import type { FlowNode } from '@/lib/flow/types'
import { CONCEPTS } from '@/lib/k6/education'
import { EXECUTORS, executorMeta } from '@/lib/k6/executors'
import { AGGREGATIONS_BY_TYPE, BUILTIN_METRICS } from '@/lib/k6/metrics'
import { maybeScenarioType } from '@/lib/k6/scenario-types'
import type { ValidationIssue } from '@/lib/validation/engine'
import { uid } from '@/lib/utils'
import { selectNodes, selectOptions, useProjectStore } from '@/stores/project-store'

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function Field({
  label,
  children,
  help
}: {
  label: string
  children: React.ReactNode
  help?: string
}): React.ReactNode {
  return (
    <div className='space-y-1.5'>
      <span className='flex items-center gap-1'>
        <Label>{label}</Label>
        {help !== undefined && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                aria-label={`Help: ${label}`}
                className='text-muted-foreground hover:text-foreground cursor-help'
              >
                <HelpCircle className='size-3' aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent side='left'>{help}</TooltipContent>
          </Tooltip>
        )}
      </span>
      {children}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }): React.ReactNode {
  return (
    <h3 className='pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>
      {children}
    </h3>
  )
}

function NodeIssues({ issues }: { issues: ValidationIssue[] }): React.ReactNode {
  if (issues.length === 0) return null
  return (
    <div className='space-y-1.5' role='alert'>
      {issues.map((issue) => (
        <div
          key={issue.id}
          className={
            issue.severity === 'error'
              ? 'rounded-md border border-destructive/40 bg-destructive/10 p-2 text-[11px]'
              : 'rounded-md border border-warning/40 bg-warning/10 p-2 text-[11px]'
          }
        >
          <p
            className={
              issue.severity === 'error' ? 'font-medium text-destructive' : 'font-medium text-warning'
            }
          >
            {issue.message}
          </p>
          <p className='mt-0.5 text-muted-foreground'>💡 {issue.fix}</p>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Executor editor                                                     */
/* ------------------------------------------------------------------ */

function StagesEditor({
  stages,
  onChange
}: {
  stages: ExecutorConfig['stages']
  onChange: (stages: ExecutorConfig['stages']) => void
}): React.ReactNode {
  return (
    <div className='space-y-1.5'>
      {stages.map((stage, indexNum) => (
        <div key={stage.id} className='flex items-center gap-1.5'>
          <span className='w-4 text-right font-mono text-[10px] text-muted-foreground'>{indexNum + 1}</span>
          <Input
            value={stage.duration}
            onChange={(event) =>
              onChange(stages.map((s) => (s.id === stage.id ? { ...s, duration: event.target.value } : s)))
            }
            className='h-8 flex-1 font-mono text-xs'
            aria-label={`Stage ${indexNum + 1} duration`}
            placeholder='30s'
          />
          <Input
            type='number'
            min={0}
            value={stage.target}
            onChange={(event) =>
              onChange(
                stages.map((s) => (s.id === stage.id ? { ...s, target: Number(event.target.value) } : s))
              )
            }
            className='h-8 w-20 font-mono text-xs'
            aria-label={`Stage ${indexNum + 1} target`}
          />
          <Button
            variant='ghost'
            size='icon'
            className='size-8 text-muted-foreground hover:text-destructive'
            onClick={() => onChange(stages.filter((s) => s.id !== stage.id))}
            aria-label={`Remove stage ${indexNum + 1}`}
          >
            <Trash2 className='size-3.5' aria-hidden />
          </Button>
        </div>
      ))}
      <Button variant='outline' size='sm' onClick={() => onChange([...stages, createStage()])}>
        <Plus className='size-3.5' aria-hidden />
        Add stage
      </Button>
      <p className='text-[10px] text-muted-foreground'>duration · target (VUs or rate)</p>
    </div>
  )
}

function ExecutorEditor({
  config,
  onChange
}: {
  config: ExecutorConfig
  onChange: (config: ExecutorConfig) => void
}): React.ReactNode {
  const meta = executorMeta(config.type)

  const numberField = (
    key: 'vus' | 'iterations' | 'startVUs' | 'rate' | 'startRate' | 'preAllocatedVUs' | 'maxVUs',
    label: string,
    help: string
  ): React.ReactNode => (
    <Field key={key} label={label} help={help}>
      <Input
        type='number'
        min={0}
        value={config[key]}
        onChange={(event) => onChange({ ...config, [key]: Number(event.target.value) })}
        className='font-mono text-xs'
      />
    </Field>
  )
  const durationField = (
    key: 'maxDuration' | 'duration' | 'gracefulRampDown' | 'timeUnit',
    label: string,
    help: string
  ): React.ReactNode => (
    <Field key={key} label={label} help={help}>
      <Input
        value={config[key]}
        onChange={(event) => onChange({ ...config, [key]: event.target.value })}
        className='font-mono text-xs'
        placeholder='30s'
      />
    </Field>
  )

  return (
    <div className='space-y-3'>
      <Field label='Executor' help={meta.whenToUse}>
        <Select
          value={config.type}
          onChange={(event) => onChange({ ...config, type: event.target.value as ExecutorType })}
        >
          {EXECUTORS.map((executor) => (
            <option key={executor.type} value={executor.type}>
              {executor.label}
            </option>
          ))}
        </Select>
      </Field>
      <p className='rounded-md bg-muted p-2 text-[11px] leading-relaxed text-muted-foreground'>
        {meta.summary}
      </p>

      <div className='grid grid-cols-2 gap-2'>
        {meta.fields.map((field) => {
          if (field.kind === 'stages') return null
          if (field.kind === 'number') {
            return numberField(field.key as 'vus', field.label, field.help)
          }
          return durationField(field.key as 'duration', field.label, field.help)
        })}
      </div>

      {meta.fields.some((field) => field.kind === 'stages') && (
        <Field label='Stages' help={meta.fields.find((f) => f.kind === 'stages')?.help}>
          <StagesEditor stages={config.stages} onChange={(stages) => onChange({ ...config, stages })} />
        </Field>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Checks / extractors                                                 */
/* ------------------------------------------------------------------ */

const CHECK_KINDS: Array<{ value: CheckKind; label: string }> = [
  { value: 'status', label: 'Status code' },
  { value: 'duration', label: 'Response time (ms)' },
  { value: 'body-contains', label: 'Body contains' },
  { value: 'json-path', label: 'JSON field' },
  { value: 'header', label: 'Header' }
]

const OPERATORS: Array<{ value: CheckDef['operator']; label: string }> = [
  { value: 'eq', label: '=' },
  { value: 'neq', label: '≠' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '≤' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '≥' },
  { value: 'contains', label: 'contains' },
  { value: 'exists', label: 'exists' }
]

function ChecksEditor({
  checks,
  onChange
}: {
  checks: CheckDef[]
  onChange: (checks: CheckDef[]) => void
}): React.ReactNode {
  const update = (id: string, patch: Partial<CheckDef>): void =>
    onChange(checks.map((checkDef) => (checkDef.id === id ? { ...checkDef, ...patch } : checkDef)))

  return (
    <div className='space-y-2'>
      {checks.map((checkDef) => (
        <div key={checkDef.id} className='space-y-1.5 rounded-md border border-border p-2'>
          <div className='flex items-center gap-1.5'>
            <Input
              value={checkDef.label}
              onChange={(event) => update(checkDef.id, { label: event.target.value })}
              className='h-8 flex-1 text-xs'
              placeholder='check name (shown in results)'
              aria-label='Check name'
            />
            <Button
              variant='ghost'
              size='icon'
              className='size-8 text-muted-foreground hover:text-destructive'
              onClick={() => onChange(checks.filter((c) => c.id !== checkDef.id))}
              aria-label='Remove check'
            >
              <Trash2 className='size-3.5' aria-hidden />
            </Button>
          </div>
          <div className='flex items-center gap-1.5'>
            <Select
              value={checkDef.kind}
              onChange={(event) => update(checkDef.id, { kind: event.target.value as CheckKind })}
              className='w-36'
              aria-label='Check type'
            >
              {CHECK_KINDS.map((kind) => (
                <option key={kind.value} value={kind.value}>
                  {kind.label}
                </option>
              ))}
            </Select>
            {(checkDef.kind === 'json-path' || checkDef.kind === 'header') && (
              <Input
                value={checkDef.target}
                onChange={(event) => update(checkDef.id, { target: event.target.value })}
                className='h-9 flex-1 font-mono text-xs'
                placeholder={checkDef.kind === 'json-path' ? 'data.token' : 'Content-Type'}
                aria-label={checkDef.kind === 'json-path' ? 'JSON path' : 'Header name'}
              />
            )}
            <Select
              value={checkDef.operator}
              onChange={(event) =>
                update(checkDef.id, { operator: event.target.value as CheckDef['operator'] })
              }
              className='w-24'
              aria-label='Operator'
            >
              {OPERATORS.map((op) => (
                <option key={op.value} value={op.value}>
                  {op.label}
                </option>
              ))}
            </Select>
            {checkDef.operator !== 'exists' && (
              <Input
                value={checkDef.value}
                onChange={(event) => update(checkDef.id, { value: event.target.value })}
                className='h-9 w-24 font-mono text-xs'
                placeholder='value'
                aria-label='Expected value'
              />
            )}
          </div>
        </div>
      ))}
      <Button variant='outline' size='sm' onClick={() => onChange([...checks, createCheck()])}>
        <Plus className='size-3.5' aria-hidden />
        Add check
      </Button>
    </div>
  )
}

function ExtractorsEditor({
  extractors,
  onChange
}: {
  extractors: ExtractorDef[]
  onChange: (extractors: ExtractorDef[]) => void
}): React.ReactNode {
  const update = (id: string, patch: Partial<ExtractorDef>): void =>
    onChange(extractors.map((extractor) => (extractor.id === id ? { ...extractor, ...patch } : extractor)))

  return (
    <div className='space-y-1.5'>
      {extractors.map((extractor) => (
        <div key={extractor.id} className='flex items-center gap-1.5'>
          <Input
            value={extractor.variable}
            onChange={(event) => update(extractor.id, { variable: event.target.value })}
            className='h-8 w-24 font-mono text-xs'
            placeholder='authToken'
            aria-label='Variable name'
          />
          <Select
            value={extractor.source}
            onChange={(event) =>
              update(extractor.id, { source: event.target.value as ExtractorDef['source'] })
            }
            className='w-24'
            aria-label='Extractor source'
          >
            <option value='json'>JSON</option>
            <option value='header'>Header</option>
            <option value='status'>Status</option>
          </Select>
          {extractor.source !== 'status' && (
            <Input
              value={extractor.expression}
              onChange={(event) => update(extractor.id, { expression: event.target.value })}
              className='h-8 flex-1 font-mono text-xs'
              placeholder={extractor.source === 'json' ? 'data.token' : 'X-Request-Id'}
              aria-label='Expression'
            />
          )}
          <Button
            variant='ghost'
            size='icon'
            className='size-8 text-muted-foreground hover:text-destructive'
            onClick={() => onChange(extractors.filter((e) => e.id !== extractor.id))}
            aria-label='Remove extractor'
          >
            <Trash2 className='size-3.5' aria-hidden />
          </Button>
        </div>
      ))}
      <Button
        variant='outline'
        size='sm'
        onClick={() => onChange([...extractors, { id: uid(), variable: '', source: 'json', expression: '' }])}
      >
        <Plus className='size-3.5' aria-hidden />
        Extract variable
      </Button>
      <p className='text-[10px] text-muted-foreground'>
        Reference extracted values downstream as <code className='font-mono'>{'{{variable}}'}</code>.
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Threshold editor                                                    */
/* ------------------------------------------------------------------ */

function ThresholdEditor({
  threshold,
  customMetrics,
  onChange
}: {
  threshold: ThresholdDef
  customMetrics: CustomMetricDef[]
  onChange: (threshold: ThresholdDef) => void
}): React.ReactNode {
  const metricType: MetricType =
    BUILTIN_METRICS.find((m) => m.name === threshold.metric)?.type ??
    customMetrics.find((m) => m.name === threshold.metric)?.type ??
    'trend'
  const aggregations = AGGREGATIONS_BY_TYPE[metricType]

  return (
    <div className='space-y-3'>
      <Field label='Metric' help='The metric this pass/fail criterion is evaluated against.'>
        <Select
          value={threshold.metric}
          onChange={(event) => {
            const metric = event.target.value
            const type: MetricType =
              BUILTIN_METRICS.find((m) => m.name === metric)?.type ??
              customMetrics.find((m) => m.name === metric)?.type ??
              'trend'
            onChange({ ...threshold, metric, aggregation: AGGREGATIONS_BY_TYPE[type][0] })
          }}
        >
          <optgroup label='Built-in metrics'>
            {BUILTIN_METRICS.map((metric) => (
              <option key={metric.name} value={metric.name}>
                {metric.name}
              </option>
            ))}
          </optgroup>
          {customMetrics.filter((m) => m.name !== '').length > 0 && (
            <optgroup label='Custom metrics'>
              {customMetrics
                .filter((m) => m.name !== '')
                .map((metric) => (
                  <option key={metric.id} value={metric.name}>
                    {metric.name}
                  </option>
                ))}
            </optgroup>
          )}
        </Select>
      </Field>

      <div className='grid grid-cols-3 gap-2'>
        <Field label='Aggregation'>
          <Select
            value={threshold.aggregation}
            onChange={(event) =>
              onChange({ ...threshold, aggregation: event.target.value as ThresholdAggregation })
            }
          >
            {aggregations.map((aggregation) => (
              <option key={aggregation} value={aggregation}>
                {aggregation}
              </option>
            ))}
          </Select>
        </Field>
        <Field label='Operator'>
          <Select
            value={threshold.operator}
            onChange={(event) =>
              onChange({ ...threshold, operator: event.target.value as ThresholdOperator })
            }
          >
            {['<', '<=', '>', '>=', '==', '!='].map((operator) => (
              <option key={operator} value={operator}>
                {operator}
              </option>
            ))}
          </Select>
        </Field>
        <Field label='Value'>
          <Input
            value={threshold.value}
            onChange={(event) => onChange({ ...threshold, value: event.target.value })}
            className='font-mono text-xs'
            placeholder='500'
          />
        </Field>
      </div>

      <div className='flex items-center justify-between rounded-md border border-border p-2'>
        <div>
          <p className='text-xs font-medium'>Abort on fail</p>
          <p className='text-[10px] text-muted-foreground'>
            Stop the whole test as soon as this threshold fails.
          </p>
        </div>
        <Switch
          checked={threshold.abortOnFail}
          onCheckedChange={(abortOnFail) => onChange({ ...threshold, abortOnFail })}
          aria-label='Abort on fail'
        />
      </div>
      {threshold.abortOnFail && (
        <Field
          label='Delay abort evaluation'
          help='Give the test time to warm up before the abort check kicks in, e.g. 10s.'
        >
          <Input
            value={threshold.delayAbortEval}
            onChange={(event) => onChange({ ...threshold, delayAbortEval: event.target.value })}
            className='font-mono text-xs'
            placeholder='10s (optional)'
          />
        </Field>
      )}

      <p className='rounded-md bg-muted p-2 font-mono text-[11px]'>
        {threshold.metric}: {threshold.aggregation}
        {threshold.operator}
        {threshold.value}
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */

interface PropertiesPanelProps {
  selected: FlowNode | null
  issuesByRef: Map<string, ValidationIssue[]>
}

export function PropertiesPanel({ selected, issuesByRef }: PropertiesPanelProps): React.ReactNode {
  const updateNodeData = useProjectStore((state) => state.updateNodeData)
  const options = useProjectStore(selectOptions)
  const setOptions = useProjectStore((state) => state.setOptions)
  const requests = useProjectStore((state) => state.requests)
  const nodes = useProjectStore(selectNodes)

  const customMetrics = nodes
    .filter((node): node is Extract<FlowNode, { type: 'metric' }> => node.type === 'metric')
    .map((node) => node.data.metric)

  const issues = selected !== null ? (issuesByRef.get(selected.id) ?? []) : (issuesByRef.get('') ?? [])

  return (
    <aside
      className='flex w-80 shrink-0 flex-col overflow-y-auto border-l border-border bg-background/60'
      aria-label='Properties panel'
    >
      <div className='border-b border-border px-4 py-3'>
        <h2 className='text-sm font-semibold'>
          {selected === null ? 'Suite options' : panelTitle(selected)}
        </h2>
        <p className='text-[11px] text-muted-foreground'>
          {selected === null
            ? 'HTTP behaviour shared by every scenario in this suite.'
            : selected.type === 'scenario'
              ? 'This workload only — nothing here touches another scenario.'
              : 'Configure the selected node.'}
        </p>
      </div>

      <div className='space-y-3 p-4'>
        <NodeIssues issues={issues} />

        {selected === null && <GlobalOptionsEditor options={options} setOptions={setOptions} />}

        {selected?.type === 'scenario' && (
          <ScenarioEditor
            scenario={selected.data.scenario}
            customMetrics={customMetrics}
            onChange={(scenario) => updateNodeData(selected.id, { scenario })}
          />
        )}

        {selected?.type === 'request' && (
          <div className='space-y-4'>
            <Field label='Name'>
              <Input
                value={selected.data.request.name}
                onChange={(event) =>
                  updateNodeData(selected.id, {
                    request: { ...selected.data.request, name: event.target.value }
                  })
                }
              />
            </Field>
            <RequestEditor
              compact
              request={selected.data.request}
              onChange={(patch) =>
                updateNodeData(selected.id, { request: { ...selected.data.request, ...patch } })
              }
            />
            <SectionTitle>Checks</SectionTitle>
            <ChecksEditor
              checks={selected.data.request.checks}
              onChange={(checks) =>
                updateNodeData(selected.id, { request: { ...selected.data.request, checks } })
              }
            />
            <SectionTitle>Extract variables</SectionTitle>
            <ExtractorsEditor
              extractors={selected.data.request.extractors}
              onChange={(extractors) =>
                updateNodeData(selected.id, { request: { ...selected.data.request, extractors } })
              }
            />
            <SectionTitle>Timeout & tags</SectionTitle>
            <div className='w-32'>
              <Field label='Timeout'>
                <Input
                  value={selected.data.request.timeout}
                  onChange={(event) =>
                    updateNodeData(selected.id, {
                      request: { ...selected.data.request, timeout: event.target.value }
                    })
                  }
                  className='font-mono text-xs'
                  placeholder='60s'
                />
              </Field>
            </div>
            <KeyValueEditor
              items={selected.data.request.tags}
              onChange={(tags) =>
                updateNodeData(selected.id, { request: { ...selected.data.request, tags } })
              }
              keyPlaceholder='tag'
              valuePlaceholder='value'
              addLabel='Add metric tag'
            />
          </div>
        )}

        {selected?.type === 'batch' && (
          <div className='space-y-3'>
            <Field label='Batch name'>
              <Input
                value={selected.data.name}
                onChange={(event) => updateNodeData(selected.id, { name: event.target.value })}
              />
            </Field>
            <SectionTitle>Requests in this batch</SectionTitle>
            <p className='text-[11px] text-muted-foreground'>
              All selected requests are sent in parallel with <code className='font-mono'>http.batch()</code>.
            </p>
            <div className='space-y-1.5'>
              {requests.map((request) => {
                const included = selected.data.requests.some(
                  (r) => r.name === request.name && r.url === request.url
                )
                return (
                  <label
                    key={request.id}
                    className='flex cursor-pointer items-center gap-2 rounded-md border border-border p-2 text-xs'
                  >
                    <input
                      type='checkbox'
                      checked={included}
                      onChange={(event) => {
                        const next = event.target.checked
                          ? [...selected.data.requests, structuredClone({ ...request, id: uid() })]
                          : selected.data.requests.filter(
                              (r) => !(r.name === request.name && r.url === request.url)
                            )
                        updateNodeData(selected.id, { requests: next })
                      }}
                      className='accent-[var(--primary)]'
                    />
                    <span className='font-mono text-[10px] font-bold'>{request.method}</span>
                    <span className='min-w-0 flex-1 truncate'>{request.name}</span>
                  </label>
                )
              })}
              {requests.length === 0 && (
                <p className='text-[11px] text-muted-foreground'>
                  Import requests in Step 1 to add them to the batch.
                </p>
              )}
            </div>
          </div>
        )}

        {selected?.type === 'group' && (
          <Field
            label='Group name'
            help='Becomes the group tag on every metric emitted inside — name it after the business step.'
          >
            <Input
              value={selected.data.name}
              onChange={(event) => updateNodeData(selected.id, { name: event.target.value })}
            />
          </Field>
        )}

        {selected?.type === 'sleep' && (
          <Field label='Duration (seconds)' help='Fixed pause executed with sleep().'>
            <Input
              type='number'
              min={0}
              step={0.5}
              value={selected.data.seconds}
              onChange={(event) => updateNodeData(selected.id, { seconds: Number(event.target.value) })}
              className='font-mono text-xs'
            />
          </Field>
        )}

        {selected?.type === 'think-time' && (
          <div className='grid grid-cols-2 gap-2'>
            <Field label='Min (seconds)'>
              <Input
                type='number'
                min={0}
                step={0.5}
                value={selected.data.minSeconds}
                onChange={(event) => updateNodeData(selected.id, { minSeconds: Number(event.target.value) })}
                className='font-mono text-xs'
              />
            </Field>
            <Field label='Max (seconds)'>
              <Input
                type='number'
                min={0}
                step={0.5}
                value={selected.data.maxSeconds}
                onChange={(event) => updateNodeData(selected.id, { maxSeconds: Number(event.target.value) })}
                className='font-mono text-xs'
              />
            </Field>
            <p className='col-span-2 text-[11px] text-muted-foreground'>
              A random pause in this range is generated per iteration — it de-synchronizes virtual users, like
              real people reading a page.
            </p>
          </div>
        )}

        {selected?.type === 'conditional' && (
          <Field
            label='Condition (JavaScript)'
            help='Evaluated at runtime inside the iteration. You can reference extracted variables, __ITER, __VU…'
          >
            <Textarea
              value={selected.data.condition}
              onChange={(event) => updateNodeData(selected.id, { condition: event.target.value })}
              rows={3}
              spellCheck={false}
              className='font-mono text-xs'
              placeholder='__ITER % 2 === 0'
            />
          </Field>
        )}

        {selected?.type === 'loop' && (
          <Field
            label='Iterations'
            help='The body chain runs this many times before the flow continues via the next handle.'
          >
            <Input
              type='number'
              min={1}
              value={selected.data.iterations}
              onChange={(event) => updateNodeData(selected.id, { iterations: Number(event.target.value) })}
              className='font-mono text-xs'
            />
          </Field>
        )}

        {selected?.type === 'threshold' && (
          <div className='space-y-3'>
            <p className='rounded-md bg-muted p-2 text-[11px] leading-relaxed text-muted-foreground'>
              A suite-wide gate: it applies whichever scenario runs. For a gate that judges one workload only,
              add it to that scenario instead — it is then scoped with{' '}
              <code className='font-mono'>{'{scenario:name}'}</code>.
            </p>
            <ThresholdEditor
              threshold={selected.data.threshold}
              customMetrics={customMetrics}
              onChange={(threshold) => updateNodeData(selected.id, { threshold })}
            />
          </div>
        )}

        {selected?.type === 'metric' && (
          <div className='space-y-3'>
            <Field
              label='Metric name'
              help='Referenced by thresholds and emitted in results. Letters, digits, underscores.'
            >
              <Input
                value={selected.data.metric.name}
                onChange={(event) =>
                  updateNodeData(selected.id, {
                    metric: { ...selected.data.metric, name: event.target.value }
                  })
                }
                className='font-mono text-xs'
                placeholder='checkout_duration'
              />
            </Field>
            <Field label='Type'>
              <Select
                value={selected.data.metric.type}
                onChange={(event) => {
                  const type = event.target.value as MetricType
                  updateNodeData(selected.id, {
                    metric: { ...selected.data.metric, type, isTime: type === 'trend' }
                  })
                }}
              >
                <option value='trend'>Trend — distributions & percentiles</option>
                <option value='counter'>Counter — cumulative sum</option>
                <option value='rate'>Rate — fraction of non-zero values</option>
                <option value='gauge'>Gauge — latest value</option>
              </Select>
            </Field>
            {selected.data.metric.type === 'trend' && (
              <div className='flex items-center justify-between rounded-md border border-border p-2'>
                <p className='text-xs'>Values are durations (time)</p>
                <Switch
                  checked={selected.data.metric.isTime}
                  onCheckedChange={(isTime) =>
                    updateNodeData(selected.id, { metric: { ...selected.data.metric, isTime } })
                  }
                  aria-label='Time metric'
                />
              </div>
            )}
          </div>
        )}

        {selected?.type === 'env-var' && (
          <EnvVarEditor
            envVar={selected.data.envVar}
            onChange={(envVar) => updateNodeData(selected.id, { envVar })}
          />
        )}

        {selected?.type === 'shared-data' && (
          <SharedDataEditor
            sharedData={selected.data.sharedData}
            onChange={(sharedData) => updateNodeData(selected.id, { sharedData })}
          />
        )}

        {(selected?.type === 'setup' || selected?.type === 'teardown') && (
          <p className='rounded-md bg-muted p-3 text-[11px] leading-relaxed text-muted-foreground'>
            {selected.type === 'setup'
              ? 'Connect steps after this node — they run once before the load starts (obtain tokens, seed data). The setup duration does not pollute your main metrics.'
              : 'Connect steps after this node — they run once after the test finishes, for cleanup.'}
          </p>
        )}
      </div>

      {/* Contextual education */}
      <div className='mt-auto border-t border-border p-4'>
        <ConceptHint selectedType={selected?.type ?? null} />
      </div>
    </aside>
  )
}

function panelTitle(node: FlowNode): string {
  switch (node.type) {
    case 'scenario':
      return `Scenario · ${node.data.scenario.name}`
    case 'request':
      return 'HTTP Request'
    case 'batch':
      return 'Parallel HTTP Batch'
    case 'group':
      return 'Group'
    case 'sleep':
      return 'Sleep'
    case 'think-time':
      return 'Think Time'
    case 'conditional':
      return 'Conditional Branch'
    case 'loop':
      return 'Loop'
    case 'threshold':
      return 'Threshold'
    case 'metric':
      return 'Custom Metric'
    case 'env-var':
      return 'Environment Variable'
    case 'shared-data':
      return 'Shared Data'
    case 'setup':
      return 'Setup'
    case 'teardown':
      return 'Teardown'
    default:
      return 'Node'
  }
}

const CONCEPT_BY_TYPE: Record<string, string> = {
  scenario: 'scenario',
  request: 'check',
  threshold: 'threshold',
  'think-time': 'think-time',
  sleep: 'think-time',
  'env-var': 'env-vars',
  'shared-data': 'shared-array',
  setup: 'setup-teardown',
  teardown: 'setup-teardown',
  batch: 'virtual-user',
  loop: 'virtual-user',
  conditional: 'virtual-user',
  group: 'scenario',
  metric: 'threshold'
}

function ConceptHint({ selectedType }: { selectedType: string | null }): React.ReactNode {
  const conceptId = selectedType !== null ? CONCEPT_BY_TYPE[selectedType] : 'executor'
  const concept = CONCEPTS.find((c) => c.id === conceptId) ?? CONCEPTS[0]
  return (
    <details className='group'>
      <summary className='flex cursor-pointer items-center gap-1.5 text-xs font-medium text-primary'>
        <HelpCircle className='size-3.5' aria-hidden />
        {concept.question}
      </summary>
      <p className='mt-2 text-[11px] leading-relaxed text-muted-foreground'>{concept.answer}</p>
    </details>
  )
}

/* ------------------------------------------------------------------ */
/* Scenario editor                                                     */
/* ------------------------------------------------------------------ */

/**
 * Everything one workload owns. Nothing here is shared with another scenario:
 * changing a ramp, a gate, a tag or an env var affects this scenario only, in
 * the builder and in the generated script.
 */
function ScenarioEditor({
  scenario,
  customMetrics,
  onChange
}: {
  scenario: ScenarioDef
  customMetrics: CustomMetricDef[]
  onChange: (scenario: ScenarioDef) => void
}): React.ReactNode {
  const type = maybeScenarioType(scenario.typeId)
  const color = scenarioTypeColor(scenario.typeId)

  return (
    <div className='space-y-3'>
      {/* What this workload is for */}
      {type !== undefined && (
        <div
          className='rounded-lg border p-2.5'
          style={{
            borderColor: `color-mix(in oklab, ${color} 35%, transparent)`,
            backgroundColor: `color-mix(in oklab, ${color} 7%, transparent)`
          }}
        >
          <p className='flex items-center gap-1.5 text-xs font-semibold'>
            <span style={{ color }}>
              <ScenarioTypeIcon typeId={scenario.typeId} className='size-3.5' />
            </span>
            {type.label}
            <Badge variant='outline'>{type.approxDuration}</Badge>
          </p>
          <p className='mt-1 text-[11px] leading-relaxed text-muted-foreground'>{type.summary}</p>
          <details className='mt-1.5'>
            <summary className='cursor-pointer text-[11px] font-medium text-primary'>
              Why run this, and what to look at
            </summary>
            <p className='mt-1 text-[11px] leading-relaxed text-muted-foreground'>{type.description}</p>
            <p className='mt-1.5 text-[11px] leading-relaxed text-muted-foreground'>
              <span className='font-medium text-foreground'>Answers:</span> {type.answers}
            </p>
            <p className='mt-1 text-[11px] leading-relaxed text-muted-foreground'>
              <span className='font-medium text-foreground'>Watch for:</span> {type.watchFor}
            </p>
          </details>
        </div>
      )}

      <SectionTitle>General</SectionTitle>
      <Field
        label='Scenario name'
        help='Identifies the workload in k6 results, keys options.scenarios and is what -e SCENARIO= selects.'
      >
        <Input
          value={scenario.name}
          onChange={(event) => onChange({ ...scenario, name: event.target.value })}
          className='font-mono text-xs'
        />
      </Field>
      <Field label='Description' help='Carried into the generated README so the suite documents itself.'>
        <Textarea
          value={scenario.description}
          onChange={(event) => onChange({ ...scenario, description: event.target.value })}
          rows={2}
          className='text-xs'
          placeholder='What question does this workload answer?'
        />
      </Field>
      <div className='flex items-center justify-between rounded-md border border-border p-2'>
        <div className='pr-2'>
          <p className='text-xs font-medium'>Enabled</p>
          <p className='text-[10px] text-muted-foreground'>
            Disabled scenarios stay in the suite but are left out of the script.
          </p>
        </div>
        <Switch
          checked={scenario.enabled}
          onCheckedChange={(enabled) => onChange({ ...scenario, enabled })}
          aria-label='Scenario enabled'
        />
      </div>

      <SectionTitle>Execution</SectionTitle>
      <ExecutorEditor
        config={scenario.executor}
        onChange={(executor) => onChange({ ...scenario, executor })}
      />

      <div className='space-y-1'>
        <Label>Load profile</Label>
        <RampChart config={scenario.executor} color={color} />
      </div>

      <SectionTitle>Scheduling</SectionTitle>
      <div className='grid grid-cols-2 gap-2'>
        <Field
          label='Start time'
          help='Delay before this scenario starts, relative to test start — lets scenarios run in sequence when the suite runs them together.'
        >
          <Input
            value={scenario.startTime}
            onChange={(event) => onChange({ ...scenario, startTime: event.target.value })}
            className='font-mono text-xs'
            placeholder='0s'
          />
        </Field>
        <Field
          label='Graceful stop'
          help='Time iterations get to finish when the scenario ends before VUs are killed.'
        >
          <Input
            value={scenario.gracefulStop}
            onChange={(event) => onChange({ ...scenario, gracefulStop: event.target.value })}
            className='font-mono text-xs'
            placeholder='30s'
          />
        </Field>
      </div>

      <SectionTitle>Quality gates</SectionTitle>
      <p className='text-[11px] leading-relaxed text-muted-foreground'>
        Judged on this scenario&rsquo;s samples only — emitted as{' '}
        <code className='font-mono'>{`metric{scenario:${scenario.name}}`}</code>. Checks belong to each
        request, and custom metrics are shared by the whole suite.
      </p>
      <ScenarioThresholdsEditor
        scenario={scenario}
        customMetrics={customMetrics}
        onChange={(thresholds) => onChange({ ...scenario, thresholds })}
      />

      <SectionTitle>Scenario tags</SectionTitle>
      <p className='text-[11px] leading-relaxed text-muted-foreground'>
        Added to every metric this scenario emits, so results stay separable per workload.
      </p>
      <KeyValueEditor
        items={scenario.tags}
        onChange={(tags) => onChange({ ...scenario, tags })}
        keyPlaceholder='tag'
        valuePlaceholder='value'
        addLabel='Add tag'
      />

      <SectionTitle>Scenario environment</SectionTitle>
      <p className='text-[11px] leading-relaxed text-muted-foreground'>
        Exposed on <code className='font-mono'>__ENV</code> for this scenario only — the documented way to run
        the same journey against different data.
      </p>
      <KeyValueEditor
        items={scenario.env}
        onChange={(env) => onChange({ ...scenario, env })}
        keyPlaceholder='NAME'
        valuePlaceholder='value'
        addLabel='Add variable'
      />
    </div>
  )
}

/**
 * The gates that judge this scenario alone. They are emitted as tag-scoped
 * thresholds (`http_req_duration{scenario:smoke}`), so a smoke gate can never
 * fail because the stress scenario was slow.
 */
function ScenarioThresholdsEditor({
  scenario,
  customMetrics,
  onChange
}: {
  scenario: ScenarioDef
  customMetrics: CustomMetricDef[]
  onChange: (thresholds: ThresholdDef[]) => void
}): React.ReactNode {
  const type = maybeScenarioType(scenario.typeId)

  return (
    <div className='space-y-2'>
      {scenario.thresholds.length === 0 && (
        <p className='rounded-md border border-warning/40 bg-warning/10 p-2 text-[11px] leading-relaxed'>
          No gates — this scenario can never fail automatically. Without one, k6 exits 0 even when the SLO is
          missed.
        </p>
      )}
      {scenario.thresholds.map((threshold, indexNum) => (
        <details key={threshold.id} className='rounded-md border border-border p-2' open={indexNum === 0}>
          <summary className='flex cursor-pointer items-center gap-1.5'>
            <span className='min-w-0 flex-1 truncate font-mono text-[11px]'>
              {threshold.metric}: {threshold.aggregation}
              {threshold.operator}
              {threshold.value}
            </span>
            {threshold.abortOnFail && <Badge variant='destructive'>abort</Badge>}
            <Button
              variant='ghost'
              size='icon'
              className='size-6 text-muted-foreground hover:text-destructive'
              onClick={(event) => {
                event.preventDefault()
                onChange(scenario.thresholds.filter((entry) => entry.id !== threshold.id))
              }}
              aria-label={`Remove gate on ${threshold.metric}`}
            >
              <Trash2 className='size-3.5' aria-hidden />
            </Button>
          </summary>
          <div className='mt-2'>
            <ThresholdEditor
              threshold={threshold}
              customMetrics={customMetrics}
              onChange={(updated) =>
                onChange(scenario.thresholds.map((entry) => (entry.id === threshold.id ? updated : entry)))
              }
            />
          </div>
        </details>
      ))}
      <div className='flex flex-wrap gap-1.5'>
        <Button
          variant='outline'
          size='sm'
          onClick={() => onChange([...scenario.thresholds, createThreshold('http_req_duration')])}
        >
          <Plus className='size-3.5' aria-hidden />
          Add gate
        </Button>
        {type !== undefined && (
          <Button variant='ghost' size='sm' onClick={() => onChange(type.buildThresholds())}>
            <RotateCcw className='size-3.5' aria-hidden />
            Reset to {type.label} defaults
          </Button>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Env var / shared data editors                                       */
/* ------------------------------------------------------------------ */

function EnvVarEditor({
  envVar,
  onChange
}: {
  envVar: EnvVarDef
  onChange: (envVar: EnvVarDef) => void
}): React.ReactNode {
  return (
    <div className='space-y-3'>
      <Field
        label='Variable name'
        help='Exposed on __ENV and generated as a const — reference it anywhere as {{NAME}}.'
      >
        <Input
          value={envVar.name}
          onChange={(event) => onChange({ ...envVar, name: event.target.value })}
          className='font-mono text-xs'
          placeholder='API_TOKEN'
        />
      </Field>
      <Field label='Default value'>
        <Input
          value={envVar.defaultValue}
          onChange={(event) => onChange({ ...envVar, defaultValue: event.target.value })}
          className='font-mono text-xs'
          placeholder='(empty — must be passed with -e)'
        />
      </Field>
      <div className='flex items-center justify-between rounded-md border border-border p-2'>
        <div>
          <p className='text-xs font-medium'>Required</p>
          <p className='text-[10px] text-muted-foreground'>The script throws at startup when missing.</p>
        </div>
        <Switch
          checked={envVar.required}
          onCheckedChange={(required) => onChange({ ...envVar, required })}
          aria-label='Required'
        />
      </div>
      <Field label='Description'>
        <Input
          value={envVar.description}
          onChange={(event) => onChange({ ...envVar, description: event.target.value })}
        />
      </Field>
    </div>
  )
}

function SharedDataEditor({
  sharedData,
  onChange
}: {
  sharedData: SharedDataDef
  onChange: (sharedData: SharedDataDef) => void
}): React.ReactNode {
  return (
    <div className='space-y-3'>
      <Field label='Identifier' help='The SharedArray const name in the generated script.'>
        <Input
          value={sharedData.name}
          onChange={(event) => onChange({ ...sharedData, name: event.target.value })}
          className='font-mono text-xs'
          placeholder='users'
        />
      </Field>
      <Field
        label='JSON array'
        help='Loaded once and shared read-only across all VUs — the memory-safe way to parameterize tests.'
      >
        <Textarea
          value={sharedData.json}
          onChange={(event) => onChange({ ...sharedData, json: event.target.value })}
          rows={8}
          spellCheck={false}
          className='font-mono text-xs leading-relaxed'
        />
      </Field>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Global options                                                      */
/* ------------------------------------------------------------------ */

function GlobalOptionsEditor({
  options,
  setOptions
}: {
  options: GlobalOptions
  setOptions: (patch: Partial<GlobalOptions>) => void
}): React.ReactNode {
  return (
    <div className='space-y-3'>
      <Field
        label='User agent'
        help='Sent as the User-Agent header on every request. Empty keeps the k6 default.'
      >
        <Input
          value={options.userAgent}
          onChange={(event) => setOptions({ userAgent: event.target.value })}
          className='font-mono text-xs'
          placeholder='k6/1.x (default)'
        />
      </Field>
      <div className='grid grid-cols-2 gap-2'>
        <Field label='Max redirects'>
          <Input
            type='number'
            min={0}
            value={options.maxRedirects}
            onChange={(event) => setOptions({ maxRedirects: Number(event.target.value) })}
            className='font-mono text-xs'
          />
        </Field>
        <Field label='Setup timeout'>
          <Input
            value={options.setupTimeout}
            onChange={(event) => setOptions({ setupTimeout: event.target.value })}
            className='font-mono text-xs'
            placeholder='60s'
          />
        </Field>
      </div>

      {(
        [
          [
            'insecureSkipTLSVerify',
            'Skip TLS verification',
            'Accept self-signed certificates — test environments only.'
          ],
          [
            'discardResponseBodies',
            'Discard response bodies',
            'Saves load-generator memory at high RPS. Checks on bodies stop working.'
          ],
          ['noConnectionReuse', 'Disable keep-alive', 'Forces a new TCP connection per request.'],
          [
            'throw',
            'Throw on request error',
            'http.* functions throw instead of returning an error response.'
          ]
        ] as const
      ).map(([key, label, help]) => (
        <div key={key} className='flex items-center justify-between rounded-md border border-border p-2'>
          <div className='pr-2'>
            <p className='text-xs font-medium'>{label}</p>
            <p className='text-[10px] text-muted-foreground'>{help}</p>
          </div>
          <Switch
            checked={options[key]}
            onCheckedChange={(value) => setOptions({ [key]: value })}
            aria-label={label}
          />
        </div>
      ))}

      <SectionTitle>DNS</SectionTitle>
      <div className='grid grid-cols-3 gap-2'>
        <Field label='TTL'>
          <Input
            value={options.dns.ttl}
            onChange={(event) => setOptions({ dns: { ...options.dns, ttl: event.target.value } })}
            className='font-mono text-xs'
          />
        </Field>
        <Field label='Select'>
          <Select
            value={options.dns.select}
            onChange={(event) =>
              setOptions({ dns: { ...options.dns, select: event.target.value as typeof options.dns.select } })
            }
          >
            <option value='first'>first</option>
            <option value='random'>random</option>
            <option value='roundRobin'>roundRobin</option>
          </Select>
        </Field>
        <Field label='Policy'>
          <Select
            value={options.dns.policy}
            onChange={(event) =>
              setOptions({ dns: { ...options.dns, policy: event.target.value as typeof options.dns.policy } })
            }
          >
            <option value='preferIPv4'>preferIPv4</option>
            <option value='preferIPv6'>preferIPv6</option>
            <option value='onlyIPv4'>onlyIPv4</option>
            <option value='onlyIPv6'>onlyIPv6</option>
            <option value='any'>any</option>
          </Select>
        </Field>
      </div>

      <SectionTitle>Global tags</SectionTitle>
      <KeyValueEditor
        items={options.tags}
        onChange={(tags) => setOptions({ tags })}
        keyPlaceholder='tag'
        valuePlaceholder='value'
        addLabel='Add global tag'
      />

      <SectionTitle>Summary trend stats</SectionTitle>
      <Input
        value={options.summaryTrendStats.join(', ')}
        onChange={(event) =>
          setOptions({
            summaryTrendStats: event.target.value
              .split(',')
              .map((stat) => stat.trim())
              .filter(Boolean)
          })
        }
        className='font-mono text-xs'
        aria-label='Summary trend stats'
      />
      <p className='text-[10px] text-muted-foreground'>
        Statistics shown for trend metrics in the end-of-test summary, e.g. avg, p(90), p(95), p(99).
      </p>

      <div className='rounded-md bg-muted p-2 text-[11px] text-muted-foreground'>
        <Badge variant='outline' className='mb-1'>
          Tip
        </Badge>
        <p>
          Each scenario carries its own thresholds — select it in the Scenarios panel. Threshold nodes on the
          canvas are suite-wide gates that apply whichever scenario runs; custom metrics, environment
          variables and shared data are shared too.
        </p>
      </div>
    </div>
  )
}
