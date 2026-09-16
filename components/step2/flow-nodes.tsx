'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import {
  Boxes,
  Braces,
  Clock,
  Database,
  FlaskConical,
  Gauge,
  GitBranch,
  Globe,
  Layers,
  Moon,
  Play,
  Repeat2,
  Split,
  Variable,
  Wrench
} from 'lucide-react'
import { ScenarioTypeIcon, scenarioTypeColor } from '@/components/shared/scenario-type-icon'
import type { FlowNode } from '@/lib/flow/types'
import { executorMeta } from '@/lib/k6/executors'
import { loadProfile } from '@/lib/k6/load-profile'
import { maybeScenarioType } from '@/lib/k6/scenario-types'
import { cn, formatDuration, truncate } from '@/lib/utils'

type NodePropsFor<T extends FlowNode['type']> = NodeProps<Extract<FlowNode, { type: T }>>

interface ShellProps {
  icon: React.ReactNode
  tint: string
  title: string
  subtitle?: string
  badge?: string
  children?: React.ReactNode
  hasTarget?: boolean
  hasSource?: boolean
}

function NodeShell({
  icon,
  tint,
  title,
  subtitle,
  badge,
  children,
  hasTarget = true,
  hasSource = true
}: ShellProps): React.ReactNode {
  return (
    <div className='k6-node w-56 rounded-lg border border-border bg-card shadow-md transition-shadow'>
      {hasTarget && <Handle type='target' position={Position.Left} aria-label='Input' />}
      <div className='flex items-center gap-2 border-b border-border px-3 py-2'>
        <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-md', tint)}>
          {icon}
        </span>
        <span className='min-w-0 flex-1 truncate text-xs font-semibold'>{title}</span>
        {badge !== undefined && (
          <span className='shrink-0 rounded-full bg-muted px-1.5 py-0.5 font-mono text-[9px] font-bold text-muted-foreground'>
            {badge}
          </span>
        )}
      </div>
      {(subtitle !== undefined || children !== undefined) && (
        <div className='px-3 py-2'>
          {subtitle !== undefined && (
            <p className='truncate font-mono text-[10px] text-muted-foreground'>{subtitle}</p>
          )}
          {children}
        </div>
      )}
      {hasSource && <Handle type='source' position={Position.Right} aria-label='Output' />}
    </div>
  )
}

/**
 * A workload entry point. The type's hue and icon match its card in the
 * Scenarios panel, so the lane feeding a journey is identifiable at a glance —
 * and several lanes into the same journey is the normal, healthy shape.
 */
function ScenarioNode({ data }: NodePropsFor<'scenario'>): React.ReactNode {
  const { scenario } = data
  const meta = executorMeta(scenario.executor.type)
  const type = maybeScenarioType(scenario.typeId)
  const color = scenarioTypeColor(scenario.typeId)
  const profile = loadProfile(scenario.executor)

  return (
    <div
      className={cn(
        'k6-node w-56 overflow-hidden rounded-lg border bg-card shadow-md transition-shadow',
        scenario.enabled ? 'border-border' : 'border-dashed border-muted-foreground/40 opacity-60'
      )}
    >
      <span className='absolute inset-y-0 left-0 w-1' style={{ backgroundColor: color }} aria-hidden />
      <div className='flex items-center gap-2 border-b border-border pl-3.5 pr-3 py-2'>
        <span
          className='flex size-6 shrink-0 items-center justify-center rounded-md'
          style={{ backgroundColor: `color-mix(in oklab, ${color} 16%, transparent)`, color }}
        >
          <ScenarioTypeIcon typeId={scenario.typeId} className='size-3.5' />
        </span>
        <span className='min-w-0 flex-1 truncate font-mono text-xs font-semibold'>{scenario.name}</span>
        <span
          className='shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[9px] font-bold'
          style={{ backgroundColor: `color-mix(in oklab, ${color} 16%, transparent)`, color }}
        >
          {(type?.label ?? 'CUSTOM').replace(/ Test$/, '').toUpperCase()}
        </span>
      </div>
      <div className='space-y-0.5 pl-3.5 pr-3 py-2'>
        <p className='truncate font-mono text-[10px] text-muted-foreground'>{meta.label}</p>
        <p className='flex items-center gap-2 font-mono text-[10px] text-muted-foreground'>
          <span>
            peak {profile.peak} {profile.unit}
          </span>
          <span>· {formatDuration(profile.duration)}</span>
        </p>
        {!scenario.enabled && (
          <p className='font-mono text-[10px] font-medium text-warning'>disabled — not exported</p>
        )}
      </div>
      <Handle type='source' position={Position.Right} aria-label='Output' />
    </div>
  )
}

function RequestNode({ data }: NodePropsFor<'request'>): React.ReactNode {
  return (
    <NodeShell
      icon={<Globe className='size-3.5' aria-hidden />}
      tint='bg-success/15 text-success'
      title={data.request.name}
      subtitle={`${data.request.method} ${truncate(data.request.url, 32)}`}
      badge={data.request.checks.length > 0 ? `${data.request.checks.length} ✓` : undefined}
    />
  )
}

function BatchNode({ data }: NodePropsFor<'batch'>): React.ReactNode {
  return (
    <NodeShell
      icon={<Layers className='size-3.5' aria-hidden />}
      tint='bg-success/15 text-success'
      title={data.name}
      subtitle={`${data.requests.length} parallel request${data.requests.length === 1 ? '' : 's'}`}
      badge='BATCH'
    />
  )
}

function GroupNode({ data }: NodePropsFor<'group'>): React.ReactNode {
  return (
    <div className='k6-node h-full w-full rounded-xl border-2 border-dashed border-primary/40 bg-primary/5'>
      <Handle type='target' position={Position.Left} aria-label='Input' />
      <div className='flex items-center gap-2 px-3 py-2'>
        <Boxes className='size-4 text-primary' aria-hidden />
        <span className='text-xs font-semibold'>{data.name}</span>
        <span className='rounded-full bg-primary/15 px-1.5 py-0.5 font-mono text-[9px] font-bold text-primary'>
          GROUP
        </span>
      </div>
      <Handle type='source' position={Position.Right} aria-label='Output' />
    </div>
  )
}

function SleepNode({ data }: NodePropsFor<'sleep'>): React.ReactNode {
  return (
    <NodeShell
      icon={<Moon className='size-3.5' aria-hidden />}
      tint='bg-accent text-accent-foreground'
      title='Sleep'
      subtitle={`${data.seconds}s fixed pause`}
    />
  )
}

function ThinkTimeNode({ data }: NodePropsFor<'think-time'>): React.ReactNode {
  return (
    <NodeShell
      icon={<Clock className='size-3.5' aria-hidden />}
      tint='bg-accent text-accent-foreground'
      title='Think Time'
      subtitle={`random ${data.minSeconds}–${data.maxSeconds}s`}
    />
  )
}

function ConditionalNode({ data }: NodePropsFor<'conditional'>): React.ReactNode {
  return (
    <div className='k6-node w-56 rounded-lg border border-border bg-card shadow-md'>
      <Handle type='target' position={Position.Left} aria-label='Input' />
      <div className='flex items-center gap-2 border-b border-border px-3 py-2'>
        <span className='flex size-6 items-center justify-center rounded-md bg-warning/15 text-warning'>
          <GitBranch className='size-3.5' aria-hidden />
        </span>
        <span className='flex-1 truncate text-xs font-semibold'>Conditional</span>
      </div>
      <div className='space-y-1.5 px-3 py-2'>
        <p className='truncate font-mono text-[10px] text-muted-foreground'>
          {data.condition === '' ? 'no condition set' : data.condition}
        </p>
        <div className='relative flex justify-between font-mono text-[10px]'>
          <span className='text-success'>true →</span>
          <span className='text-destructive'>false →</span>
        </div>
      </div>
      <Handle
        id='true'
        type='source'
        position={Position.Right}
        style={{ top: '55%' }}
        aria-label='True branch'
      />
      <Handle
        id='false'
        type='source'
        position={Position.Right}
        style={{ top: '82%' }}
        aria-label='False branch'
      />
    </div>
  )
}

function LoopNode({ data }: NodePropsFor<'loop'>): React.ReactNode {
  return (
    <div className='k6-node w-56 rounded-lg border border-border bg-card shadow-md'>
      <Handle type='target' position={Position.Left} aria-label='Input' />
      <div className='flex items-center gap-2 border-b border-border px-3 py-2'>
        <span className='flex size-6 items-center justify-center rounded-md bg-warning/15 text-warning'>
          <Repeat2 className='size-3.5' aria-hidden />
        </span>
        <span className='flex-1 truncate text-xs font-semibold'>Loop ×{data.iterations}</span>
      </div>
      <div className='flex justify-between px-3 py-2 font-mono text-[10px] text-muted-foreground'>
        <span>body ↓</span>
        <span>next →</span>
      </div>
      <Handle id='body' type='source' position={Position.Bottom} aria-label='Loop body' />
      <Handle id='next' type='source' position={Position.Right} aria-label='After loop' />
    </div>
  )
}

function ThresholdNode({ data }: NodePropsFor<'threshold'>): React.ReactNode {
  const t = data.threshold
  return (
    <NodeShell
      icon={<Gauge className='size-3.5' aria-hidden />}
      tint='bg-destructive/15 text-destructive'
      title='Threshold'
      subtitle={`${t.metric}: ${t.aggregation}${t.operator}${t.value}`}
      badge={t.abortOnFail ? 'ABORT' : undefined}
      hasTarget={false}
      hasSource={false}
    />
  )
}

function MetricNode({ data }: NodePropsFor<'metric'>): React.ReactNode {
  return (
    <NodeShell
      icon={<FlaskConical className='size-3.5' aria-hidden />}
      tint='bg-accent text-accent-foreground'
      title={data.metric.name === '' ? 'Custom metric' : data.metric.name}
      subtitle={data.metric.type}
      hasTarget={false}
      hasSource={false}
    />
  )
}

function EnvVarNode({ data }: NodePropsFor<'env-var'>): React.ReactNode {
  return (
    <NodeShell
      icon={<Variable className='size-3.5' aria-hidden />}
      tint='bg-accent text-accent-foreground'
      title={data.envVar.name === '' ? 'Environment variable' : data.envVar.name}
      subtitle={
        data.envVar.defaultValue === ''
          ? data.envVar.required
            ? 'required, no default'
            : 'no default'
          : `default: ${truncate(data.envVar.defaultValue, 24)}`
      }
      hasTarget={false}
      hasSource={false}
    />
  )
}

function SharedDataNode({ data }: NodePropsFor<'shared-data'>): React.ReactNode {
  return (
    <NodeShell
      icon={<Database className='size-3.5' aria-hidden />}
      tint='bg-accent text-accent-foreground'
      title={`SharedArray: ${data.sharedData.name}`}
      subtitle='read-only, shared across VUs'
      hasTarget={false}
      hasSource={false}
    />
  )
}

function SetupNode(): React.ReactNode {
  return (
    <NodeShell
      icon={<Wrench className='size-3.5' aria-hidden />}
      tint='bg-secondary text-secondary-foreground'
      title='setup()'
      subtitle='runs once before the test'
      badge='LIFECYCLE'
      hasTarget={false}
    />
  )
}

function TeardownNode(): React.ReactNode {
  return (
    <NodeShell
      icon={<Split className='size-3.5 rotate-90' aria-hidden />}
      tint='bg-secondary text-secondary-foreground'
      title='teardown(data)'
      subtitle='runs once after the test'
      badge='LIFECYCLE'
      hasTarget={false}
    />
  )
}

export const NODE_TYPES = {
  scenario: ScenarioNode,
  request: RequestNode,
  batch: BatchNode,
  group: GroupNode,
  sleep: SleepNode,
  'think-time': ThinkTimeNode,
  conditional: ConditionalNode,
  loop: LoopNode,
  threshold: ThresholdNode,
  metric: MetricNode,
  'env-var': EnvVarNode,
  'shared-data': SharedDataNode,
  setup: SetupNode,
  teardown: TeardownNode
}

export const NODE_PALETTE: Array<{
  category: string
  items: Array<{ type: FlowNode['type'] & string; label: string; icon: React.ReactNode; help: string }>
}> = [
  {
    category: 'Flow',
    items: [
      {
        type: 'scenario',
        label: 'Scenario',
        icon: <Play className='size-4' aria-hidden />,
        help: 'A blank workload entry point. For a configured one — smoke, load, spike … — use Add in the Scenarios panel.'
      },
      {
        type: 'group',
        label: 'Group',
        icon: <Boxes className='size-4' aria-hidden />,
        help: 'Wraps steps in group() — results get a group tag per business step.'
      },
      {
        type: 'sleep',
        label: 'Sleep',
        icon: <Moon className='size-4' aria-hidden />,
        help: 'Fixed pause between steps.'
      },
      {
        type: 'think-time',
        label: 'Think Time',
        icon: <Clock className='size-4' aria-hidden />,
        help: 'Randomized pause simulating a real user reading the page.'
      },
      {
        type: 'conditional',
        label: 'Conditional',
        icon: <GitBranch className='size-4' aria-hidden />,
        help: 'Fork the flow on a JavaScript expression.'
      },
      {
        type: 'loop',
        label: 'Loop',
        icon: <Repeat2 className='size-4' aria-hidden />,
        help: 'Repeat the body chain N times.'
      }
    ]
  },
  {
    category: 'HTTP',
    items: [
      {
        type: 'request',
        label: 'HTTP Request',
        icon: <Globe className='size-4' aria-hidden />,
        help: 'A single HTTP call with headers, body, auth, checks and extractors.'
      },
      {
        type: 'batch',
        label: 'HTTP Batch',
        icon: <Layers className='size-4' aria-hidden />,
        help: 'Multiple requests issued in parallel with http.batch().'
      }
    ]
  },
  {
    category: 'Validation',
    items: [
      {
        type: 'threshold',
        label: 'Threshold',
        icon: <Gauge className='size-4' aria-hidden />,
        help: 'Pass/fail criterion on a metric — fails the run in CI when crossed.'
      },
      {
        type: 'metric',
        label: 'Custom Metric',
        icon: <FlaskConical className='size-4' aria-hidden />,
        help: 'Trend, Counter, Rate or Gauge you can threshold on.'
      }
    ]
  },
  {
    category: 'Runtime',
    items: [
      {
        type: 'env-var',
        label: 'Environment Variable',
        icon: <Variable className='size-4' aria-hidden />,
        help: '__ENV variable with default — reference it as {{NAME}}.'
      },
      {
        type: 'shared-data',
        label: 'Shared Data',
        icon: <Database className='size-4' aria-hidden />,
        help: 'SharedArray of test data, one copy for all VUs.'
      },
      {
        type: 'setup',
        label: 'Setup',
        icon: <Wrench className='size-4' aria-hidden />,
        help: 'Steps that run once before the test starts.'
      },
      {
        type: 'teardown',
        label: 'Teardown',
        icon: <Braces className='size-4' aria-hidden />,
        help: 'Steps that run once after the test ends.'
      }
    ]
  }
]
