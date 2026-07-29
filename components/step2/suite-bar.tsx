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
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { AnimatePresence, motion } from 'framer-motion'
import {
  CheckCircle2,
  Copy,
  Download,
  FileArchive,
  FileCode2,
  MoreVertical,
  Pencil,
  Plus,
  Trash2,
  XCircle
} from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { buildSuite, scenarioArtifacts } from '@/lib/export/build'
import {
  buildSuiteZip,
  downloadBlob,
  downloadText,
  slugify,
  suiteFileName,
  type SuiteArtifact
} from '@/lib/export/exporters'
import { cn } from '@/lib/utils'
import { scenarioNodesOf, useProjectStore } from '@/stores/project-store'

interface SuiteTabProps {
  id: string
  name: string
  /** Scenario count, shown so a suite reads as a set of workloads. */
  scenarioCount: number
  active: boolean
  valid: boolean
  canDelete: boolean
  onSelect: () => void
  onRename: (name: string) => void
  onDuplicate: () => void
  onDelete: () => void
  onExportJson: () => void
  onExportZip: () => void
}

function SuiteTab(props: SuiteTabProps): React.ReactNode {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.id
  })
  const [editing, setEditing] = useState(false)

  return (
    <motion.div
      ref={setNodeRef}
      layout
      initial={{ opacity: 0, y: -6, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'group flex shrink-0 items-center gap-2 rounded-t-lg border-x border-t px-3 py-2 text-sm',
        props.active
          ? 'border-border bg-background font-medium text-foreground'
          : 'border-transparent bg-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground',
        isDragging && 'z-10 opacity-80'
      )}
    >
      <button
        className='cursor-grab touch-none text-muted-foreground/50 hover:text-muted-foreground'
        aria-label={`Reorder ${props.name}`}
        {...attributes}
        {...listeners}
      >
        <FileCode2 className='size-3.5' aria-hidden />
      </button>

      <Tooltip>
        <TooltipTrigger asChild>
          <span aria-hidden>
            {props.valid ? (
              <CheckCircle2 className='size-3.5 text-success' />
            ) : (
              <XCircle className='size-3.5 text-destructive' />
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent>{props.valid ? 'Valid — ready to export' : 'Has validation errors'}</TooltipContent>
      </Tooltip>

      {editing ? (
        <Input
          autoFocus
          defaultValue={props.name}
          className='h-6 w-32 px-1.5 py-0 text-sm'
          aria-label='Suite name'
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
          className='flex cursor-pointer items-center gap-1.5 whitespace-nowrap'
          onClick={props.onSelect}
          onDoubleClick={() => setEditing(true)}
        >
          {props.name}
          <span className='rounded-full bg-muted px-1.5 py-0.5 font-mono text-[9px] font-bold text-muted-foreground'>
            {props.scenarioCount}
          </span>
        </button>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className='rounded text-muted-foreground/60 opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 cursor-pointer'
            aria-label={`${props.name} options`}
          >
            <MoreVertical className='size-4' aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='start'>
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <Pencil aria-hidden />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={props.onDuplicate}>
            <Copy aria-hidden />
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={props.onExportZip}>
            <FileArchive aria-hidden />
            Export suite ZIP
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={props.onExportJson}>
            <Download aria-hidden />
            Export suite JSON
          </DropdownMenuItem>
          {props.canDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={props.onDelete}
                className='text-destructive focus:bg-destructive/10 focus:text-destructive'
              >
                <Trash2 aria-hidden />
                Delete suite
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </motion.div>
  )
}

export function SuiteBar({ validityBySuite }: { validityBySuite: Map<string, boolean> }): React.ReactNode {
  const suites = useProjectStore((state) => state.suites)
  const activeSuiteId = useProjectStore((state) => state.activeSuiteId)
  const meta = useProjectStore((state) => state.meta)
  const setActiveSuite = useProjectStore((state) => state.setActiveSuite)
  const addSuite = useProjectStore((state) => state.addSuite)
  const duplicateSuite = useProjectStore((state) => state.duplicateSuite)
  const renameSuite = useProjectStore((state) => state.renameSuite)
  const removeSuite = useProjectStore((state) => state.removeSuite)
  const reorderSuites = useProjectStore((state) => state.reorderSuites)
  const exportSuite = useProjectStore((state) => state.exportSuite)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event
    if (over === null || active.id === over.id) return
    const from = suites.findIndex((suite) => suite.id === active.id)
    const to = suites.findIndex((suite) => suite.id === over.id)
    if (from !== -1 && to !== -1) reorderSuites(from, to)
  }

  const handleExportJson = (id: string): void => {
    const suite = suites.find((entry) => entry.id === id)
    downloadText(
      JSON.stringify(exportSuite(id), null, 2),
      `${slugify(suite?.name ?? 'suite')}.suite.json`,
      'application/json'
    )
  }

  const handleExportZip = (id: string): void => {
    const suite = suites.find((entry) => entry.id === id)
    if (suite === undefined) return
    const build = buildSuite(meta, suite)
    const artifact: SuiteArtifact = {
      id: suite.id,
      name: suite.name,
      description: suite.description,
      execution: build.plan.execution,
      scenarios: scenarioArtifacts(build.plan),
      fileName: suiteFileName(suite.name, new Set<string>()),
      plan: build.plan,
      script: build.script
    }
    void buildSuiteZip(meta, artifact).then((blob) => downloadBlob(blob, `${slugify(suite.name)}.zip`))
  }

  return (
    <div className='flex shrink-0 items-end gap-1 border-b border-border bg-card px-4 pt-2'>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className='mb-2 mr-1 shrink-0 cursor-help text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>
            Suites
          </span>
        </TooltipTrigger>
        <TooltipContent side='bottom' className='max-w-72'>
          One suite = one exported script, holding all the scenarios that measure one journey. Add a suite
          when the journey differs — not when the load shape does.
        </TooltipContent>
      </Tooltip>
      <div className='flex flex-1 items-end gap-1 overflow-x-auto'>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={suites.map((suite) => suite.id)} strategy={horizontalListSortingStrategy}>
            <AnimatePresence initial={false}>
              {suites.map((suite) => (
                <SuiteTab
                  key={suite.id}
                  id={suite.id}
                  name={suite.name}
                  scenarioCount={scenarioNodesOf(suite.nodes).length}
                  active={suite.id === activeSuiteId}
                  valid={validityBySuite.get(suite.id) ?? true}
                  canDelete={suites.length > 1}
                  onSelect={() => setActiveSuite(suite.id)}
                  onRename={(name) => renameSuite(suite.id, name)}
                  onDuplicate={() => duplicateSuite(suite.id)}
                  onDelete={() => removeSuite(suite.id)}
                  onExportJson={() => handleExportJson(suite.id)}
                  onExportZip={() => handleExportZip(suite.id)}
                />
              ))}
            </AnimatePresence>
          </SortableContext>
        </DndContext>
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant='ghost' size='sm' className='mb-1.5 shrink-0' onClick={() => addSuite()}>
            <Plus className='size-4' aria-hidden />
            Add suite
          </Button>
        </TooltipTrigger>
        <TooltipContent side='bottom' className='max-w-72'>
          A second script, for a different journey. To measure *this* journey under another load shape, add a
          scenario instead.
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
