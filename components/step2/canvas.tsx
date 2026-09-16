'use client'

import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type NodeChange
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ClipboardPaste, Copy, CopyPlus, Expand, LayoutGrid, Redo2, Trash2, Undo2 } from 'lucide-react'
import { useCallback, useMemo, useRef } from 'react'
import { NODE_TYPES } from '@/components/step2/flow-nodes'
import { DND_MIME } from '@/components/step2/sidebar'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { FlowNode, FlowNodeType } from '@/lib/flow/types'
import { selectActiveSuite, selectEdges, selectNodes, useProjectStore } from '@/stores/project-store'

interface CanvasProps {
  invalidNodeIds: Set<string>
  orphanNodeIds: Set<string>
}

function ToolbarButton({
  label,
  onClick,
  disabled,
  children
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}): React.ReactNode {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant='ghost'
          size='icon'
          className='size-8'
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side='bottom'>{label}</TooltipContent>
    </Tooltip>
  )
}

export function BuilderCanvas({ invalidNodeIds, orphanNodeIds }: CanvasProps): React.ReactNode {
  const nodes = useProjectStore(selectNodes)
  const edges = useProjectStore(selectEdges)
  const onNodesChange = useProjectStore((state) => state.onNodesChange)
  const onEdgesChange = useProjectStore((state) => state.onEdgesChange)
  const onConnect = useProjectStore((state) => state.onConnect)
  const addNode = useProjectStore((state) => state.addNode)
  const pushHistory = useProjectStore((state) => state.pushHistory)
  const undo = useProjectStore((state) => state.undo)
  const redo = useProjectStore((state) => state.redo)
  const past = useProjectStore((state) => state.past)
  const future = useProjectStore((state) => state.future)
  const copySelection = useProjectStore((state) => state.copySelection)
  const paste = useProjectStore((state) => state.paste)
  const duplicateSelection = useProjectStore((state) => state.duplicateSelection)
  const removeNodes = useProjectStore((state) => state.removeNodes)
  const autoLayout = useProjectStore((state) => state.autoLayout)
  const clipboard = useProjectStore((state) => state.clipboard)

  const { screenToFlowPosition } = useReactFlow()
  const wrapperRef = useRef<HTMLDivElement>(null)

  const decoratedNodes = useMemo(
    () =>
      nodes.map((node) => {
        const invalid = invalidNodeIds.has(node.id)
        const orphan = orphanNodeIds.has(node.id)
        return {
          ...node,
          className: invalid ? 'k6-node-flag-invalid' : orphan ? 'opacity-60' : undefined
        } as FlowNode
      }),
    [nodes, invalidNodeIds, orphanNodeIds]
  )

  const handleNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      if (changes.some((change) => change.type === 'remove')) pushHistory()
      onNodesChange(changes)
    },
    [onNodesChange, pushHistory]
  )

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      const payload = event.dataTransfer.getData(DND_MIME)
      if (payload === '') return
      try {
        const { nodeType, requestId } = JSON.parse(payload) as { nodeType: FlowNodeType; requestId?: string }
        const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
        const nodeId = addNode(nodeType, position, requestId)

        /* If dropped inside a group container, adopt it */
        const state = useProjectStore.getState()
        const activeSuite = selectActiveSuite(state)
        const groups = activeSuite.nodes.filter((node) => node.type === 'group' && node.id !== nodeId)
        for (const group of groups) {
          const width = (group.width ?? 440) as number
          const height = (group.height ?? 280) as number
          if (
            position.x > group.position.x &&
            position.x < group.position.x + width &&
            position.y > group.position.y &&
            position.y < group.position.y + height &&
            nodeType !== 'group' &&
            nodeType !== 'scenario'
          ) {
            useProjectStore.setState({
              suites: state.suites.map((suite) =>
                suite.id === state.activeSuiteId
                  ? {
                      ...suite,
                      nodes: suite.nodes.map((node) =>
                        node.id === nodeId
                          ? ({
                              ...node,
                              parentId: group.id,
                              extent: 'parent',
                              position: {
                                x: position.x - group.position.x,
                                y: position.y - group.position.y
                              }
                            } as FlowNode)
                          : node
                      )
                    }
                  : suite
              )
            })
            break
          }
        }
      } catch {
        /* Ignore malformed drops */
      }
    },
    [addNode, screenToFlowPosition]
  )

  const selectedIds = nodes.filter((node) => node.selected === true).map((node) => node.id)
  /* Scenarios alone are not a journey — prompt for steps until there is one. */
  const journeyIsEmpty = !nodes.some((node) => node.type === 'request' || node.type === 'batch')

  const handleKeyDown = (event: React.KeyboardEvent): void => {
    const isMod = event.metaKey || event.ctrlKey
    if (!isMod) return
    const target = event.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
    const key = event.key.toLowerCase()
    if (key === 'z' && event.shiftKey) {
      event.preventDefault()
      redo()
    } else if (key === 'z') {
      event.preventDefault()
      undo()
    } else if (key === 'y') {
      event.preventDefault()
      redo()
    } else if (key === 'c') {
      event.preventDefault()
      copySelection()
    } else if (key === 'v') {
      event.preventDefault()
      paste()
    } else if (key === 'd') {
      event.preventDefault()
      duplicateSelection()
    }
  }

  return (
    <div ref={wrapperRef} className='relative min-w-0 flex-1 bg-canvas' onKeyDown={handleKeyDown}>
      {/* Floating toolbar */}
      <div className='absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-border bg-card/95 p-1 shadow-lg backdrop-blur'>
        <ToolbarButton label='Undo (Ctrl+Z)' onClick={undo} disabled={past.length === 0}>
          <Undo2 className='size-4' aria-hidden />
        </ToolbarButton>
        <ToolbarButton label='Redo (Ctrl+Shift+Z)' onClick={redo} disabled={future.length === 0}>
          <Redo2 className='size-4' aria-hidden />
        </ToolbarButton>
        <div className='mx-0.5 h-5 w-px bg-border' aria-hidden />
        <ToolbarButton label='Copy (Ctrl+C)' onClick={copySelection} disabled={selectedIds.length === 0}>
          <Copy className='size-4' aria-hidden />
        </ToolbarButton>
        <ToolbarButton label='Paste (Ctrl+V)' onClick={paste} disabled={clipboard === null}>
          <ClipboardPaste className='size-4' aria-hidden />
        </ToolbarButton>
        <ToolbarButton
          label='Duplicate (Ctrl+D)'
          onClick={duplicateSelection}
          disabled={selectedIds.length === 0}
        >
          <CopyPlus className='size-4' aria-hidden />
        </ToolbarButton>
        <ToolbarButton
          label='Delete selection (Del)'
          onClick={() => removeNodes(selectedIds)}
          disabled={selectedIds.length === 0}
        >
          <Trash2 className='size-4' aria-hidden />
        </ToolbarButton>
        <div className='mx-0.5 h-5 w-px bg-border' aria-hidden />
        <ToolbarButton label='Auto layout' onClick={autoLayout} disabled={nodes.length === 0}>
          <LayoutGrid className='size-4' aria-hidden />
        </ToolbarButton>
        <ToolbarButton
          label='Fullscreen'
          onClick={() => {
            if (document.fullscreenElement !== null) void document.exitFullscreen()
            else void wrapperRef.current?.requestFullscreen()
          }}
        >
          <Expand className='size-4' aria-hidden />
        </ToolbarButton>
      </div>

      <ReactFlow
        nodes={decoratedNodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStart={() => pushHistory()}
        onDrop={handleDrop}
        onDragOver={(event) => {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
        }}
        deleteKeyCode={['Backspace', 'Delete']}
        snapToGrid
        snapGrid={[16, 16]}
        fitView
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        multiSelectionKeyCode={['Shift']}
        selectionKeyCode={null}
        className='!bg-canvas'
        aria-label='Test design canvas'
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1.25} color='var(--canvas-dots)' />
        <Controls position='bottom-left' showInteractive={false} />
        <MiniMap
          position='bottom-right'
          pannable
          zoomable
          nodeColor='var(--primary)'
          nodeStrokeColor='transparent'
        />
      </ReactFlow>

      {journeyIsEmpty && (
        <div className='pointer-events-none absolute inset-0 flex items-center justify-center'>
          <div className='max-w-sm rounded-xl border border-dashed border-border bg-card/70 p-6 text-center backdrop-blur'>
            <p className='text-sm font-medium'>
              {nodes.length === 0 ? 'This suite has no scenarios yet' : 'Now draw the journey'}
            </p>
            <p className='mt-1 text-xs leading-relaxed text-muted-foreground'>
              {nodes.length === 0 ? (
                <>
                  Add a workload in the <strong>Scenarios</strong> panel, then draw the journey it measures.
                </>
              ) : (
                <>
                  Drag your imported requests onto the canvas and connect them after the scenario. Every
                  scenario wired to the same first step measures the same journey — one function in the
                  generated script.
                </>
              )}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
