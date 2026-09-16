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
import { Copy, FolderInput, GripVertical, ListChecks, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { RequestEditorDialog } from '@/components/step1/request-editor-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import type { HttpMethod, HttpRequestDef } from '@/lib/dsl/types'
import { cn, truncate } from '@/lib/utils'
import { useProjectStore } from '@/stores/project-store'

const METHOD_STYLE: Record<HttpMethod, string> = {
  GET: 'text-success',
  POST: 'text-primary',
  PUT: 'text-warning',
  PATCH: 'text-warning',
  DELETE: 'text-destructive',
  HEAD: 'text-muted-foreground',
  OPTIONS: 'text-muted-foreground'
}

function SortableRequestRow({
  request,
  group,
  onEdit
}: {
  request: HttpRequestDef
  group: string
  onEdit: () => void
}): React.ReactNode {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: request.id
  })
  const updateRequest = useProjectStore((state) => state.updateRequest)
  const removeRequest = useProjectStore((state) => state.removeRequest)
  const duplicateRequest = useProjectStore((state) => state.duplicateRequest)
  const setRequestGroup = useProjectStore((state) => state.setRequestGroup)
  const [renaming, setRenaming] = useState(false)
  const [grouping, setGrouping] = useState(false)

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'group flex items-center gap-2 rounded-md border border-border bg-card px-2 py-2 shadow-sm',
        isDragging && 'z-10 opacity-80 shadow-lg'
      )}
    >
      <button
        className='cursor-grab touch-none text-muted-foreground hover:text-foreground'
        aria-label={`Reorder ${request.name}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className='size-4' aria-hidden />
      </button>

      <span className={cn('w-14 shrink-0 font-mono text-[11px] font-bold', METHOD_STYLE[request.method])}>
        {request.method}
      </span>

      <div className='min-w-0 flex-1'>
        {renaming ? (
          <Input
            autoFocus
            defaultValue={request.name}
            className='h-7 text-xs'
            aria-label='Request name'
            onBlur={(event) => {
              updateRequest(request.id, {
                name: event.target.value.trim() === '' ? request.name : event.target.value
              })
              setRenaming(false)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
              if (event.key === 'Escape') setRenaming(false)
            }}
          />
        ) : (
          <button
            className='block w-full truncate text-left text-sm font-medium hover:text-primary cursor-text'
            onDoubleClick={() => setRenaming(true)}
            onClick={onEdit}
            title={`${request.name} — click to edit, double-click to rename`}
          >
            {request.name}
          </button>
        )}
        <p className='truncate font-mono text-[11px] text-muted-foreground'>{truncate(request.url, 64)}</p>
        {grouping && (
          <Input
            autoFocus
            defaultValue={group}
            placeholder='Group name (e.g. Auth)'
            className='mt-1 h-7 text-xs'
            aria-label='Group name'
            onBlur={(event) => {
              setRequestGroup(request.id, event.target.value.trim())
              setGrouping(false)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
              if (event.key === 'Escape') setGrouping(false)
            }}
          />
        )}
      </div>

      <div className='flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100'>
        <Button
          variant='ghost'
          size='icon'
          className='size-7'
          onClick={onEdit}
          aria-label={`Edit ${request.name}`}
        >
          <Pencil className='size-3.5' aria-hidden />
        </Button>
        <Button
          variant='ghost'
          size='icon'
          className='size-7'
          onClick={() => setGrouping(true)}
          aria-label={`Group ${request.name}`}
        >
          <FolderInput className='size-3.5' aria-hidden />
        </Button>
        <Button
          variant='ghost'
          size='icon'
          className='size-7'
          onClick={() => duplicateRequest(request.id)}
          aria-label={`Duplicate ${request.name}`}
        >
          <Copy className='size-3.5' aria-hidden />
        </Button>
        <Button
          variant='ghost'
          size='icon'
          className='size-7 hover:text-destructive'
          onClick={() => removeRequest(request.id)}
          aria-label={`Delete ${request.name}`}
        >
          <Trash2 className='size-3.5' aria-hidden />
        </Button>
      </div>
    </li>
  )
}

export function RequestList(): React.ReactNode {
  const requests = useProjectStore((state) => state.requests)
  const requestGroups = useProjectStore((state) => state.requestGroups)
  const moveRequest = useProjectStore((state) => state.moveRequest)
  const addBlankRequest = useProjectStore((state) => state.addBlankRequest)
  const [editingId, setEditingId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event
    if (over === null || active.id === over.id) return
    const fromIndex = requests.findIndex((request) => request.id === active.id)
    const toIndex = requests.findIndex((request) => request.id === over.id)
    if (fromIndex !== -1 && toIndex !== -1) moveRequest(fromIndex, toIndex)
  }

  /* Group requests preserving order */
  const grouped: Array<{ group: string; items: HttpRequestDef[] }> = []
  for (const request of requests) {
    const group = requestGroups[request.id] ?? ''
    const bucket = grouped.find((entry) => entry.group === group)
    if (bucket !== undefined) bucket.items.push(request)
    else grouped.push({ group, items: [request] })
  }

  const editing = requests.find((request) => request.id === editingId) ?? null

  return (
    <Card className='flex min-h-0 flex-col self-start lg:sticky lg:top-0 lg:max-h-full'>
      <CardHeader>
        <div className='flex items-start justify-between gap-2'>
          <div className='space-y-1'>
            <CardTitle className='flex items-center gap-2'>
              <ListChecks className='size-4 text-primary' aria-hidden />
              Imported requests
              <Badge variant='secondary'>{requests.length}</Badge>
            </CardTitle>
            <CardDescription>
              Rename, edit, reorder (drag), duplicate, group or delete before building.
            </CardDescription>
          </div>
          <Button variant='outline' size='sm' onClick={addBlankRequest}>
            New request
          </Button>
        </div>
      </CardHeader>
      <CardContent className='min-h-0 flex-1 overflow-y-auto'>
        {requests.length === 0 ? (
          <div className='flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-12 text-center'>
            <ListChecks className='size-8 text-muted-foreground/50' aria-hidden />
            <p className='text-sm text-muted-foreground'>No requests yet</p>
            <p className='max-w-56 text-xs text-muted-foreground/80'>
              Paste cURL commands on the left and hit “Parse &amp; import”.
            </p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
            accessibility={{ container: typeof document !== 'undefined' ? document.body : undefined }}
          >
            <SortableContext
              items={requests.map((request) => request.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className='space-y-4'>
                {grouped.map(({ group, items }) => (
                  <div key={group === '' ? '·ungrouped·' : group}>
                    {group !== '' && (
                      <p className='mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>
                        {group}
                      </p>
                    )}
                    <ul className='space-y-1.5'>
                      {items.map((request) => (
                        <SortableRequestRow
                          key={request.id}
                          request={request}
                          group={group}
                          onEdit={() => setEditingId(request.id)}
                        />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </CardContent>

      {editing !== null && <RequestEditorDialog request={editing} onClose={() => setEditingId(null)} />}
    </Card>
  )
}
