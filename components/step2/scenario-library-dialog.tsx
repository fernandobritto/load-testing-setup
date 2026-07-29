'use client'

import { motion } from 'framer-motion'
import { Check, GitBranch, Info, Layers, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ScenarioTypeIcon } from '@/components/shared/scenario-type-icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { journeyHead } from '@/lib/flow/clone'
import { isChainNode } from '@/lib/flow/types'
import {
  SCENARIO_BUNDLES,
  SCENARIO_TYPES_IN_ORDER,
  sortScenarioTypeIds,
  type ScenarioTypeId
} from '@/lib/k6/scenario-types'
import { cn } from '@/lib/utils'
import { selectActiveSuite, useProjectStore } from '@/stores/project-store'

function sameSelection(a: ScenarioTypeId[], b: ScenarioTypeId[]): boolean {
  const left = sortScenarioTypeIds(a)
  const right = sortScenarioTypeIds(b)
  return left.length === right.length && left.every((id, index) => id === right[index])
}

/**
 * Adds workloads to the suite in one pass.
 *
 * A performance suite is a *set* of scenarios over the same journey, so the
 * journey is reused by default: picking four types costs one click each and
 * duplicates nothing — only the load shape and the quality gates differ.
 *
 * Mounted only while open, so each opening starts from a clean slate.
 */
export function ScenarioLibraryDialog({ onClose }: { onClose: () => void }): React.ReactNode {
  const suite = useProjectStore(selectActiveSuite)
  const addScenarios = useProjectStore((state) => state.addScenarios)

  const [selected, setSelected] = useState<ScenarioTypeId[]>([])
  const [reuseJourney, setReuseJourney] = useState(true)

  const alreadyInSuite = useMemo(
    () =>
      new Set(
        suite.nodes
          .filter((node) => node.type === 'scenario')
          .map((node) => (node.type === 'scenario' ? node.data.scenario.typeId : null))
          .filter((id): id is ScenarioTypeId => id !== null)
      ),
    [suite.nodes]
  )

  const stepCount = suite.nodes.filter(
    (node) =>
      isChainNode(node) && node.type !== 'scenario' && node.type !== 'setup' && node.type !== 'teardown'
  ).length
  const hasJourney = journeyHead(suite.nodes, suite.edges) !== undefined
  const activeBundle = SCENARIO_BUNDLES.find((bundle) => sameSelection(bundle.typeIds, selected))

  const toggle = (id: ScenarioTypeId): void => {
    setSelected((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : sortScenarioTypeIds([...current, id])
    )
  }

  const submit = (): void => {
    if (selected.length === 0) return
    addScenarios(selected, { reuseJourney: reuseJourney && hasJourney })
    onClose()
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className='max-w-3xl' aria-describedby='scenario-library-description'>
        <DialogHeader>
          <DialogTitle>Add scenarios</DialogTitle>
          <DialogDescription id='scenario-library-description'>
            Every scenario is an independent workload inside{' '}
            <span className='font-medium text-foreground'>{suite.name}</span> — its own executor, ramp,
            thresholds and tags. Pick as many as the suite should be able to answer for.
          </DialogDescription>
        </DialogHeader>

        {/* Curated combinations */}
        <div>
          <Label className='mb-1.5 block'>Common combinations</Label>
          <div className='flex flex-wrap gap-1.5'>
            {SCENARIO_BUNDLES.map((bundle) => (
              <button
                key={bundle.id}
                onClick={() => setSelected(sortScenarioTypeIds(bundle.typeIds))}
                aria-pressed={activeBundle?.id === bundle.id}
                title={bundle.description}
                className={cn(
                  'cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  activeBundle?.id === bundle.id
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground'
                )}
              >
                {bundle.label}
                <span className='ml-1.5 opacity-70'>{bundle.typeIds.length}</span>
              </button>
            ))}
          </div>
          {activeBundle !== undefined && (
            <p className='mt-1.5 text-[11px] text-muted-foreground'>{activeBundle.description}</p>
          )}
        </div>

        {/* Scenario types */}
        <div
          className='grid max-h-[42vh] gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2'
          role='group'
          aria-label='Scenario types'
        >
          {SCENARIO_TYPES_IN_ORDER.map((type) => {
            const isSelected = selected.includes(type.id)
            return (
              <motion.button
                key={type.id}
                onClick={() => toggle(type.id)}
                aria-pressed={isSelected}
                whileTap={{ scale: 0.99 }}
                className={cn(
                  'flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 text-left transition-colors',
                  isSelected
                    ? 'border-primary bg-primary/5'
                    : 'border-border bg-card hover:border-primary/40 hover:bg-accent/30'
                )}
              >
                <span
                  className='mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md'
                  style={
                    isSelected
                      ? { backgroundColor: type.color, color: 'var(--card)' }
                      : {
                          backgroundColor: `color-mix(in oklab, ${type.color} 16%, transparent)`,
                          color: type.color
                        }
                  }
                >
                  {isSelected ? (
                    <Check className='size-4' aria-hidden />
                  ) : (
                    <ScenarioTypeIcon icon={type.icon} className='size-4' />
                  )}
                </span>
                <span className='min-w-0 flex-1'>
                  <span className='flex flex-wrap items-center gap-1.5'>
                    <span className='text-sm font-medium'>{type.label}</span>
                    <Badge variant='outline'>{type.approxDuration}</Badge>
                    {alreadyInSuite.has(type.id) && <Badge variant='secondary'>in suite</Badge>}
                  </span>
                  <span className='mt-0.5 block text-[11px] leading-relaxed text-muted-foreground'>
                    {type.summary}
                  </span>
                </span>
              </motion.button>
            )
          })}
        </div>

        {/* Journey reuse */}
        <div className='rounded-lg border border-border bg-muted/40 p-3'>
          <div className='flex items-start justify-between gap-3'>
            <Label htmlFor='reuse-journey' className='flex items-center gap-1.5'>
              <GitBranch className='size-3.5' aria-hidden />
              Measure the journey already on the canvas
            </Label>
            <Switch
              id='reuse-journey'
              checked={reuseJourney && hasJourney}
              disabled={!hasJourney}
              onCheckedChange={setReuseJourney}
              aria-label='Reuse the existing journey'
            />
          </div>
          <p className='mt-1.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground'>
            <Info className='mt-px size-3.5 shrink-0' aria-hidden />
            {!hasJourney
              ? 'This canvas has no steps yet. New scenarios arrive unwired — drag requests in and connect them.'
              : reuseJourney
                ? `Each new scenario is wired to the same ${stepCount} step${stepCount === 1 ? '' : 's'}, so the generated script exports one journey function that every scenario runs.`
                : 'Each new scenario arrives unwired, ready for a journey of its own.'}
          </p>
        </div>

        {/* Summary + actions */}
        <div className='flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3'>
          <p className='flex items-center gap-1.5 text-xs text-muted-foreground'>
            <Layers className='size-3.5' aria-hidden />
            {selected.length === 0 ? (
              'No scenarios selected yet.'
            ) : (
              <span>
                <strong className='text-foreground'>{selected.length}</strong> scenario
                {selected.length === 1 ? '' : 's'} added to {suite.name}
                {selected.length > 1 && ', each runnable on its own'}
              </span>
            )}
          </p>
          <div className='flex items-center gap-2'>
            <Button variant='ghost' size='sm' onClick={onClose}>
              Cancel
            </Button>
            <Button size='sm' onClick={submit} disabled={selected.length === 0}>
              <Plus className='size-3.5' aria-hidden />
              Add {selected.length > 0 && selected.length} scenario{selected.length === 1 ? '' : 's'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
