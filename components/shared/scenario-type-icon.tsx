import {
  Activity,
  BarChart3,
  Clock,
  Flame,
  Gauge,
  Layers,
  SlidersHorizontal,
  TrendingUp,
  Zap,
  type LucideIcon
} from 'lucide-react'
import { maybeScenarioType, type ScenarioTypeId } from '@/lib/k6/scenario-types'

const ICONS: Record<string, LucideIcon> = {
  flame: Flame,
  'trending-up': TrendingUp,
  gauge: Gauge,
  zap: Zap,
  clock: Clock,
  activity: Activity,
  'bar-chart-3': BarChart3,
  sliders: SlidersHorizontal
}

/** Icon for a scenario type; unknown types fall back to a neutral stack. */
export function ScenarioTypeIcon({
  typeId,
  icon,
  className
}: {
  typeId?: ScenarioTypeId | null
  icon?: string
  className?: string
}): React.ReactNode {
  const name = icon ?? maybeScenarioType(typeId)?.icon
  const Icon = name === undefined ? Layers : (ICONS[name] ?? Layers)
  return <Icon className={className} aria-hidden />
}

/** The accent colour of a scenario type, for inline styles. */
export function scenarioTypeColor(typeId: ScenarioTypeId | null | undefined): string {
  return maybeScenarioType(typeId)?.color ?? 'var(--type-custom)'
}
