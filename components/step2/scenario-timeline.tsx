'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { CalendarClock, ChevronDown } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ScenarioTypeIcon, scenarioTypeColor } from '@/components/shared/scenario-type-icon'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { loadProfile } from '@/lib/k6/load-profile'
import { maybeScenarioType } from '@/lib/k6/scenario-types'
import { cn, formatDuration, parseDurationSeconds } from '@/lib/utils'
import { scenarioNodesOf, selectActiveSuite, selectNodes, useProjectStore } from '@/stores/project-store'

/** A scenario reduced to what the timeline draws. */
interface Lane {
  id: string
  name: string
  color: string
  icon: string | undefined
  enabled: boolean
  selected: boolean
  startTime: number
  duration: number
  peak: number
  unit: string
}

/**
 * The suite on one time axis.
 *
 * In `all-together` mode the axis is the real test clock, so overlap and
 * `startTime` sequencing are visible at a glance — the thing that is impossible
 * to see from a list of cards. In `one-at-a-time` mode each scenario is drawn on
 * its own axis, which makes the comparison the user actually cares about (how
 * long, how heavy) legible without implying they run concurrently.
 */
export function ScenarioTimeline(): React.ReactNode {
  const suite = useProjectStore(selectActiveSuite)
  const nodes = useProjectStore(selectNodes)
  const scenarioNodes = useMemo(() => scenarioNodesOf(nodes), [nodes])
  const selectScenario = useProjectStore((state) => state.selectScenario)
  const [open, setOpen] = useState(true)

  if (scenarioNodes.length === 0) return null

  const lanes: Lane[] = scenarioNodes.map((node) => {
    const { scenario } = node.data
    const type = maybeScenarioType(scenario.typeId)
    const profile = loadProfile(scenario.executor)
    return {
      id: node.id,
      name: scenario.name,
      color: scenarioTypeColor(scenario.typeId),
      icon: type?.icon,
      enabled: scenario.enabled,
      selected: node.selected === true,
      startTime: parseDurationSeconds(scenario.startTime),
      duration: profile.duration,
      peak: profile.peak,
      unit: profile.unit
    }
  })

  const together = suite.execution === 'all-together'
  /* Shared clock when they run together, otherwise the longest scenario sets the
     scale so the bars stay comparable. */
  const span = together
    ? Math.max(...lanes.map((lane) => lane.startTime + lane.duration), 1)
    : Math.max(...lanes.map((lane) => lane.duration), 1)

  return (
    <div className='shrink-0 border-b border-border bg-card/60'>
      <button
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls='scenario-timeline'
        className='flex w-full cursor-pointer items-center gap-2 px-4 py-1.5 text-left'
      >
        <CalendarClock className='size-3.5 text-primary' aria-hidden />
        <span className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>
          Suite timeline
        </span>
        <Badge variant='outline'>{together ? 'one test, all scenarios' : 'one scenario per run'}</Badge>
        <span className='ml-auto font-mono text-[10px] text-muted-foreground'>
          {together ? `${formatDuration(span)} total` : `longest ${formatDuration(span)}`}
        </span>
        <ChevronDown
          className={cn('size-4 text-muted-foreground transition-transform', !open && '-rotate-90')}
          aria-hidden
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id='scenario-timeline'
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className='overflow-hidden'
          >
            <ul className='max-h-40 space-y-1 overflow-y-auto px-4 pb-2'>
              {lanes.map((lane) => {
                const offset = together ? (lane.startTime / span) * 100 : 0
                const width = Math.max((lane.duration / span) * 100, 1.5)
                return (
                  <li key={lane.id} className='flex items-center gap-2'>
                    <button
                      onClick={() => selectScenario(lane.id)}
                      className={cn(
                        'flex w-36 shrink-0 cursor-pointer items-center gap-1.5 truncate rounded px-1 py-0.5 text-left transition-colors hover:bg-muted',
                        lane.selected && 'bg-accent',
                        !lane.enabled && 'opacity-50'
                      )}
                    >
                      <span style={{ color: lane.color }}>
                        <ScenarioTypeIcon icon={lane.icon} className='size-3' />
                      </span>
                      <span className='truncate font-mono text-[10px]'>{lane.name}</span>
                    </button>

                    <div className='relative h-4 min-w-0 flex-1 rounded bg-muted/60'>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <motion.button
                            layout
                            onClick={() => selectScenario(lane.id)}
                            className={cn(
                              'absolute inset-y-0 cursor-pointer rounded transition-opacity hover:opacity-90',
                              !lane.enabled && 'opacity-35'
                            )}
                            style={{
                              left: `${offset}%`,
                              width: `${Math.min(width, 100 - offset)}%`,
                              backgroundColor: lane.color
                            }}
                            aria-label={`${lane.name}: ${formatDuration(lane.duration)}, peak ${lane.peak} ${lane.unit}`}
                          />
                        </TooltipTrigger>
                        <TooltipContent>
                          {lane.name} — {formatDuration(lane.duration)}, peak {lane.peak} {lane.unit}
                          {together && lane.startTime > 0 && `, starts at ${formatDuration(lane.startTime)}`}
                          {!lane.enabled && ' (disabled)'}
                        </TooltipContent>
                      </Tooltip>
                    </div>

                    <span className='w-20 shrink-0 text-right font-mono text-[10px] text-muted-foreground'>
                      {formatDuration(lane.duration)}
                    </span>
                  </li>
                )
              })}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
