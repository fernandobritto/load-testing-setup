'use client'

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  ChevronRight,
  Copy,
  GaugeCircle,
  GripVertical,
  Layers,
  MoreVertical,
  Pencil,
  Plus,
  ShieldCheck,
  Sparkles,
  Timer,
  Trash2,
  Users
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { RampChart } from '@/components/shared/ramp-chart'
import { ScenarioTypeIcon, scenarioTypeColor } from '@/components/shared/scenario-type-icon'
import { ScenarioLibraryDialog } from '@/components/step2/scenario-library-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { ScenarioDef, ScenarioExecutionMode, ScenarioTypeId } from '@/lib/dsl/types'
import { loadProfile } from '@/lib/k6/load-profile'
import { maybeScenarioType, SCENARIO_TYPES_IN_ORDER } from '@/lib/k6/scenario-types'
import { cn, formatDuration } from '@/lib/utils'
import {
  scenarioNodesOf,
  selectActiveSuite,
  selectNodes,
  useProjectStore,
  type ScenarioNode
} from '@/stores/project-store'

const EXECUTION_MODES: Array<{
  value: ScenarioExecutionMode
  label: string
  hint: string
}> = [
  {
    value: 'one-at-a-time',
    label: 'One at a time',
    hint: 'Alternative workloads over the same journey. The script runs the one you pick with -e SCENARIO=…, so a four-hour soak never starts next to a smoke test.'
  },
  {
    value: 'all-together',
    label: 'All together',
    hint: 'One combined workload. Every scenario runs in the same test, sequenced by its start time — for mixing browsing, checkout and a background writer.'
  }
]

/* ------------------------------------------------------------------ */
/* Card                                                                */
/* ------------------------------------------------------------------ */

interface ScenarioCardProps {
  node: ScenarioNode
  selected: boolean
  hasError: boolean
  canDelete: boolean
  onSelect: () => void
  onRename: (name: string) => void
  onToggle: (enabled: boolean) => void
  onDuplicate: () => void
  onRemove: () => void
}

function ScenarioCard(props: ScenarioCardProps): React.ReactNode {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.node.id
  })
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)

  const scenario: ScenarioDef = props.node.data.scenario
  const type = maybeScenarioType(scenario.typeId)
  const color = scenarioTypeColor(scenario.typeId)
  const profile = loadProfile(scenario.executor)
  const gates = scenario.thresholds.length

  return (
    <motion.li
      ref={setNodeRef}
      layout
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginBottom: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'group overflow-hidden rounded-lg border bg-card shadow-sm transition-colors',
        props.selected ? 'border-primary/70 ring-1 ring-primary/30' : 'border-border hover:border-primary/40',
        isDragging && 'z-10 opacity-90 shadow-lg',
        !scenario.enabled && 'opacity-60'
      )}
      /* The type's hue runs down the left edge — the fastest way to tell
         workloads apart in a long list. */
      data-scenario-type={scenario.typeId}
    >
      <div className='flex items-stretch'>
        <span className='w-1 shrink-0' style={{ backgroundColor: color }} aria-hidden />

        <div className='min-w-0 flex-1 p-2'>
          <div className='flex items-center gap-1.5'>
            <button
              className='cursor-grab touch-none text-muted-foreground/40 hover:text-muted-foreground'
              aria-label={`Reorder ${scenario.name}`}
              {...attributes}
              {...listeners}
            >
              <GripVertical className='size-3.5' aria-hidden />
            </button>

            <span
              className='flex size-6 shrink-0 items-center justify-center rounded-md'
              style={{ backgroundColor: `color-mix(in oklab, ${color} 16%, transparent)`, color }}
            >
              <ScenarioTypeIcon typeId={scenario.typeId} className='size-3.5' />
            </span>

            {editing ? (
              <Input
                autoFocus
                defaultValue={scenario.name}
                className='h-6 flex-1 px-1.5 py-0 font-mono text-xs'
                aria-label='Scenario name'
                onBlur={(event) => {
                  const value = event.target.value.trim()
                  if (value !== '') props.onRename(value)
                  setEditing(false)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
                  if (event.key === 'Escape') setEditing(false)
                }}
              />
            ) : (
              <button
                onClick={props.onSelect}
                onDoubleClick={() => setEditing(true)}
                className='min-w-0 flex-1 cursor-pointer truncate text-left font-mono text-xs font-medium'
                title={`${scenario.name} — ${type?.label ?? 'Custom'}`}
              >
                {scenario.name}
              </button>
            )}

            {props.hasError && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span aria-hidden>
                    <AlertTriangle className='size-3.5 text-destructive' />
                  </span>
                </TooltipTrigger>
                <TooltipContent>This scenario has validation errors</TooltipContent>
              </Tooltip>
            )}

            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Switch
                    checked={scenario.enabled}
                    onCheckedChange={props.onToggle}
                    aria-label={`${scenario.enabled ? 'Disable' : 'Enable'} ${scenario.name}`}
                  />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {scenario.enabled ? 'Enabled — included in the script' : 'Disabled — kept, but not exported'}
              </TooltipContent>
            </Tooltip>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className='cursor-pointer rounded text-muted-foreground/60 opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100'
                  aria-label={`${scenario.name} options`}
                >
                  <MoreVertical className='size-4' aria-hidden />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end'>
                <DropdownMenuItem onSelect={props.onSelect}>
                  <GaugeCircle aria-hidden />
                  Configure
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setEditing(true)}>
                  <Pencil aria-hidden />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={props.onDuplicate}>
                  <Copy aria-hidden />
                  Duplicate
                </DropdownMenuItem>
                {props.canDelete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={props.onRemove}
                      className='text-destructive focus:bg-destructive/10 focus:text-destructive'
                    >
                      <Trash2 aria-hidden />
                      Remove scenario
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* At-a-glance workload summary */}
          <button
            onClick={() => setExpanded((open) => !open)}
            aria-expanded={expanded}
            className='mt-1 flex w-full cursor-pointer items-center gap-2 pl-5 text-left'
          >
            <ChevronRight
              className={cn(
                'size-3 shrink-0 text-muted-foreground transition-transform',
                expanded && 'rotate-90'
              )}
              aria-hidden
            />
            <span className='min-w-0 flex-1 truncate text-[10px] uppercase tracking-wide text-muted-foreground'>
              {type?.label ?? 'Custom'}
            </span>
            <span className='flex shrink-0 items-center gap-1.5 text-[10px] text-muted-foreground'>
              <span className='flex items-center gap-0.5' title={`Peak ${profile.peak} ${profile.unit}`}>
                <Users className='size-3' aria-hidden />
                {profile.peak}
              </span>
              <span className='flex items-center gap-0.5' title='Duration'>
                <Timer className='size-3' aria-hidden />
                {formatDuration(profile.duration)}
              </span>
              <span
                className={cn('flex items-center gap-0.5', gates === 0 && 'text-warning')}
                title={
                  gates === 0 ? 'No quality gates — this scenario can never fail' : `${gates} quality gates`
                }
              >
                <ShieldCheck className='size-3' aria-hidden />
                {gates}
              </span>
            </span>
          </button>

          <AnimatePresence initial={false}>
            {expanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                className='overflow-hidden'
              >
                <div className='space-y-2 pl-5 pr-1 pt-2'>
                  <p className='text-[11px] leading-relaxed text-muted-foreground'>
                    {scenario.description || type?.summary}
                  </p>
                  <RampChart config={scenario.executor} height={64} color={color} />
                  {gates > 0 && (
                    <ul className='space-y-0.5'>
                      {scenario.thresholds.map((threshold) => (
                        <li
                          key={threshold.id}
                          className='truncate font-mono text-[10px] text-muted-foreground'
                        >
                          <span style={{ color }}>▸</span> {threshold.metric}: {threshold.aggregation}
                          {threshold.operator}
                          {threshold.value}
                          {threshold.abortOnFail && ' (abort)'}
                        </li>
                      ))}
                    </ul>
                  )}
                  <Button variant='outline' size='sm' className='w-full' onClick={props.onSelect}>
                    <GaugeCircle className='size-3.5' aria-hidden />
                    Configure scenario
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.li>
  )
}

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */

/**
 * The Scenario Builder: the suite's workloads as an ordered, editable list.
 *
 * This is the primary object of the app. A project is not one test — it is a
 * suite of scenarios (smoke, load, spike, soak, custom benchmarks) over the same
 * journey, each independently configured, enabled and gated.
 */
export function ScenarioPanel({ invalidNodeIds }: { invalidNodeIds: Set<string> }): React.ReactNode {
  const suite = useProjectStore(selectActiveSuite)
  const nodes = useProjectStore(selectNodes)
  const scenarioNodes = useMemo(() => scenarioNodesOf(nodes), [nodes])
  const addScenario = useProjectStore((state) => state.addScenario)
  const updateScenario = useProjectStore((state) => state.updateScenario)
  const toggleScenario = useProjectStore((state) => state.toggleScenario)
  const duplicateScenario = useProjectStore((state) => state.duplicateScenario)
  const removeScenario = useProjectStore((state) => state.removeScenario)
  const reorderScenarios = useProjectStore((state) => state.reorderScenarios)
  const selectScenario = useProjectStore((state) => state.selectScenario)
  const setSuiteExecution = useProjectStore((state) => state.setSuiteExecution)
  const [libraryOpen, setLibraryOpen] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event
    if (over === null || active.id === over.id) return
    const from = scenarioNodes.findIndex((node) => node.id === active.id)
    const to = scenarioNodes.findIndex((node) => node.id === over.id)
    if (from !== -1 && to !== -1) reorderScenarios(from, to)
  }

  const enabledCount = scenarioNodes.filter((node) => node.data.scenario.enabled).length
  const mode = EXECUTION_MODES.find((entry) => entry.value === suite.execution) ?? EXECUTION_MODES[0]

  return (
    <section className='flex max-h-[55%] min-h-0 flex-col border-b border-border' aria-label='Scenarios'>
      <header className='shrink-0 space-y-2 px-3 pb-2 pt-3'>
        <div className='flex items-center gap-1.5'>
          <Layers className='size-4 text-primary' aria-hidden />
          <h2 className='text-sm font-semibold'>Scenarios</h2>
          <Badge variant='outline'>
            {enabledCount === scenarioNodes.length
              ? scenarioNodes.length
              : `${enabledCount}/${scenarioNodes.length}`}
          </Badge>
          <Button
            variant='ghost'
            size='sm'
            className='ml-auto h-7 px-2'
            onClick={() => setLibraryOpen(true)}
            aria-label='Add scenarios'
          >
            <Plus className='size-3.5' aria-hidden />
            Add
          </Button>
        </div>

        {/* Execution mode — are these alternatives, or one combined workload? */}
        {scenarioNodes.length > 1 && (
          <div>
            <div
              className='flex rounded-md border border-border bg-muted/50 p-0.5'
              role='group'
              aria-label='How scenarios run'
            >
              {EXECUTION_MODES.map((entry) => (
                <button
                  key={entry.value}
                  onClick={() => setSuiteExecution(entry.value)}
                  aria-pressed={suite.execution === entry.value}
                  className={cn(
                    'flex-1 cursor-pointer rounded px-2 py-1 text-[11px] font-medium transition-colors',
                    suite.execution === entry.value
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <p className='mt-1 text-[10px] leading-relaxed text-muted-foreground'>{mode.hint}</p>
          </div>
        )}
      </header>

      <div className='min-h-0 flex-1 overflow-y-auto px-3 pb-3'>
        {scenarioNodes.length === 0 ? (
          <EmptyState onBrowse={() => setLibraryOpen(true)} onAdd={(typeId) => addScenario(typeId)} />
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext
              items={scenarioNodes.map((node) => node.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className='space-y-1.5'>
                <AnimatePresence initial={false}>
                  {scenarioNodes.map((node) => (
                    <ScenarioCard
                      key={node.id}
                      node={node}
                      selected={node.selected === true}
                      hasError={invalidNodeIds.has(node.id)}
                      canDelete={scenarioNodes.length > 1}
                      onSelect={() => selectScenario(node.id)}
                      onRename={(name) => updateScenario(node.id, { name })}
                      onToggle={(enabled) => toggleScenario(node.id, enabled)}
                      onDuplicate={() => duplicateScenario(node.id)}
                      onRemove={() => removeScenario(node.id)}
                    />
                  ))}
                </AnimatePresence>
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </div>

      {libraryOpen && <ScenarioLibraryDialog onClose={() => setLibraryOpen(false)} />}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Empty state                                                         */
/* ------------------------------------------------------------------ */

function EmptyState({
  onBrowse,
  onAdd
}: {
  onBrowse: () => void
  onAdd: (typeId: ScenarioTypeId) => void
}): React.ReactNode {
  return (
    <div className='rounded-lg border border-dashed border-border bg-muted/30 p-3 text-center'>
      <span className='mx-auto mb-2 flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary'>
        <Sparkles className='size-4' aria-hidden />
      </span>
      <p className='text-xs font-medium'>No scenarios yet</p>
      <p className='mt-1 text-[11px] leading-relaxed text-muted-foreground'>
        A suite needs at least one workload. Most start with a smoke test to prove the script runs, then add
        the load shapes they need to answer for.
      </p>
      <div className='mt-2.5 space-y-1.5'>
        {SCENARIO_TYPES_IN_ORDER.filter((type) => type.id === 'smoke' || type.id === 'load').map((type) => (
          <button
            key={type.id}
            onClick={() => onAdd(type.id)}
            className='flex w-full cursor-pointer items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-left text-xs transition-colors hover:border-primary/50 hover:bg-accent/40'
          >
            <span
              className='flex size-5 items-center justify-center rounded'
              style={{
                backgroundColor: `color-mix(in oklab, ${type.color} 16%, transparent)`,
                color: type.color
              }}
            >
              <ScenarioTypeIcon icon={type.icon} className='size-3' />
            </span>
            Add {type.label}
          </button>
        ))}
        <Button variant='outline' size='sm' className='w-full' onClick={onBrowse}>
          <Layers className='size-3.5' aria-hidden />
          Browse all {SCENARIO_TYPES_IN_ORDER.length} types
        </Button>
      </div>
    </div>
  )
}
