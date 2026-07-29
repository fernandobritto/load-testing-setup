'use client'

import { GripVertical, Search, Star, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { NODE_PALETTE } from '@/components/step2/flow-nodes'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { FlowNodeType } from '@/lib/flow/types'
import { cn } from '@/lib/utils'
import { useFavoritesStore } from '@/stores/favorites-store'
import { useProjectStore } from '@/stores/project-store'

export const DND_MIME = 'application/k6-node'

interface PaletteEntry {
  type: FlowNodeType
  label: string
  icon: React.ReactNode
  help: string
  category: string
}

const ALL_PALETTE: PaletteEntry[] = NODE_PALETTE.flatMap((section) =>
  section.items.map((item) => ({ ...item, category: section.category }))
)

function DraggableItem({
  nodeType,
  requestId,
  icon,
  label,
  help,
  subtitle,
  favoritable = false
}: {
  nodeType: FlowNodeType
  requestId?: string
  icon: React.ReactNode
  label: string
  help?: string
  subtitle?: string
  favoritable?: boolean
}): React.ReactNode {
  const isFavorite = useFavoritesStore((state) => state.favorites.includes(nodeType))
  const toggle = useFavoritesStore((state) => state.toggle)

  const content = (
    <div
      draggable
      role='button'
      tabIndex={0}
      aria-label={`Drag ${label} onto the canvas`}
      onDragStart={(event) => {
        event.dataTransfer.setData(DND_MIME, JSON.stringify({ nodeType, requestId }))
        event.dataTransfer.effectAllowed = 'move'
      }}
      className='group flex cursor-grab items-center gap-2 rounded-md border border-border bg-card px-2.5 py-2 text-sm shadow-sm transition-all hover:translate-x-0.5 hover:border-primary/50 hover:bg-accent/40 hover:shadow active:cursor-grabbing'
    >
      <span className='text-primary'>{icon}</span>
      <span className='min-w-0 flex-1'>
        <span className='block truncate font-medium'>{label}</span>
        {subtitle !== undefined && subtitle !== '' && (
          <span className='block truncate font-mono text-[10px] text-muted-foreground'>{subtitle}</span>
        )}
      </span>
      {favoritable ? (
        <button
          onClick={(event) => {
            event.stopPropagation()
            toggle(nodeType)
          }}
          aria-label={isFavorite ? `Unpin ${label}` : `Pin ${label} to favorites`}
          className={cn(
            'shrink-0 transition-colors',
            isFavorite
              ? 'text-warning'
              : 'text-muted-foreground/30 hover:text-muted-foreground group-hover:text-muted-foreground'
          )}
        >
          <Star className={cn('size-3.5', isFavorite && 'fill-current')} aria-hidden />
        </button>
      ) : (
        <GripVertical
          className='size-3.5 text-muted-foreground/40 group-hover:text-muted-foreground'
          aria-hidden
        />
      )}
    </div>
  )

  if (help === undefined) return content
  return (
    <Tooltip>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent side='right'>{help}</TooltipContent>
    </Tooltip>
  )
}

/**
 * The component palette: everything a journey is built from.
 *
 * Workloads are *not* here — they live in the Scenarios panel above, because a
 * scenario is a property of the suite, not a node you drop somewhere.
 */
export function BuilderSidebar(): React.ReactNode {
  const requests = useProjectStore((state) => state.requests)
  const requestGroups = useProjectStore((state) => state.requestGroups)
  const favorites = useFavoritesStore((state) => state.favorites)
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()
  const searching = q !== ''

  const matches = useMemo(() => {
    if (!searching) return { palette: [] as PaletteEntry[], requests: [] as typeof requests }
    return {
      palette: ALL_PALETTE.filter(
        (item) => item.label.toLowerCase().includes(q) || item.category.toLowerCase().includes(q)
      ),
      requests: requests.filter(
        (request) => request.name.toLowerCase().includes(q) || request.url.toLowerCase().includes(q)
      )
    }
  }, [q, searching, requests])

  const favoriteEntries = ALL_PALETTE.filter((item) => favorites.includes(item.type))

  return (
    <div className='flex min-h-0 flex-1 flex-col overflow-hidden' aria-label='Component palette'>
      {/* Search */}
      <div className='shrink-0 border-b border-border p-3'>
        <div className='relative'>
          <Search
            className='pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground'
            aria-hidden
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder='Search components…'
            aria-label='Search components'
            className='h-9 pl-8 pr-8'
          />
          {searching && (
            <button
              onClick={() => setQuery('')}
              aria-label='Clear search'
              className='absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer'
            >
              <X className='size-4' aria-hidden />
            </button>
          )}
        </div>
      </div>

      <div className='min-h-0 flex-1 overflow-y-auto p-3'>
        {searching ? (
          <div className='space-y-3'>
            {matches.palette.length === 0 && matches.requests.length === 0 && (
              <p className='px-1 py-8 text-center text-xs text-muted-foreground'>
                No components match “{query}”.
              </p>
            )}
            {matches.palette.length > 0 && (
              <div className='space-y-1.5'>
                <p className='px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>
                  Components
                </p>
                {matches.palette.map((item) => (
                  <DraggableItem
                    key={item.type}
                    nodeType={item.type}
                    icon={item.icon}
                    label={item.label}
                    help={item.help}
                    favoritable
                  />
                ))}
              </div>
            )}
            {matches.requests.length > 0 && (
              <div className='space-y-1.5'>
                <p className='px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>
                  Requests
                </p>
                {matches.requests.map((request) => (
                  <DraggableItem
                    key={request.id}
                    nodeType='request'
                    requestId={request.id}
                    icon={<span className='font-mono text-[9px] font-bold'>{request.method}</span>}
                    label={request.name}
                    subtitle={requestGroups[request.id]}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <Accordion type='multiple' defaultValue={['favorites', 'requests', 'HTTP', 'Flow']}>
            {favoriteEntries.length > 0 && (
              <AccordionItem value='favorites'>
                <AccordionTrigger>
                  <span className='flex items-center gap-1.5'>
                    <Star className='size-3.5 fill-current text-warning' aria-hidden />
                    Favorites
                  </span>
                </AccordionTrigger>
                <AccordionContent className='space-y-1.5'>
                  {favoriteEntries.map((item) => (
                    <DraggableItem
                      key={item.type}
                      nodeType={item.type}
                      icon={item.icon}
                      label={item.label}
                      help={item.help}
                      favoritable
                    />
                  ))}
                </AccordionContent>
              </AccordionItem>
            )}

            <AccordionItem value='requests'>
              <AccordionTrigger>Imported requests ({requests.length})</AccordionTrigger>
              <AccordionContent className='space-y-1.5'>
                {requests.length === 0 && (
                  <p className='px-1 text-[11px] text-muted-foreground'>
                    Import cURL commands in Step 1 to see them here.
                  </p>
                )}
                {requests.map((request) => (
                  <DraggableItem
                    key={request.id}
                    nodeType='request'
                    requestId={request.id}
                    icon={<span className='font-mono text-[9px] font-bold'>{request.method}</span>}
                    label={request.name}
                    subtitle={requestGroups[request.id]}
                    help={`Drop onto the canvas to add “${request.name}” to the flow.`}
                  />
                ))}
              </AccordionContent>
            </AccordionItem>

            {NODE_PALETTE.map((section) => (
              <AccordionItem key={section.category} value={section.category}>
                <AccordionTrigger>{section.category} components</AccordionTrigger>
                <AccordionContent className='space-y-1.5'>
                  {section.items.map((item) => (
                    <DraggableItem
                      key={item.type}
                      nodeType={item.type}
                      icon={item.icon}
                      label={item.label}
                      help={item.help}
                      favoritable
                    />
                  ))}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}
      </div>
    </div>
  )
}
