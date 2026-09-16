'use client'

import { ReactFlowProvider } from '@xyflow/react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, CheckCircle2, ChevronUp, XCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { BuilderCanvas } from '@/components/step2/canvas'
import { PropertiesPanel } from '@/components/step2/properties-panel'
import { ScenarioPanel } from '@/components/step2/scenario-panel'
import { ScenarioTimeline } from '@/components/step2/scenario-timeline'
import { BuilderSidebar } from '@/components/step2/sidebar'
import { Badge } from '@/components/ui/badge'
import { compileFlow } from '@/lib/flow/compile'
import type { ValidationIssue, ValidationResult } from '@/lib/validation/engine'
import { cn } from '@/lib/utils'
import { selectEdges, selectNodes, selectOptions, useProjectStore } from '@/stores/project-store'

interface StepBuilderProps {
  validation: ValidationResult
}

export function StepBuilder({ validation }: StepBuilderProps): React.ReactNode {
  const nodes = useProjectStore(selectNodes)
  const edges = useProjectStore(selectEdges)
  const meta = useProjectStore((state) => state.meta)
  const options = useProjectStore(selectOptions)
  const [issuesOpen, setIssuesOpen] = useState(false)

  const selected = nodes.find((node) => node.selected === true) ?? null

  const { issuesByRef, invalidNodeIds } = useMemo(() => {
    const byRef = new Map<string, ValidationIssue[]>()
    const invalid = new Set<string>()
    for (const issue of validation.issues) {
      const list = byRef.get(issue.refId) ?? []
      list.push(issue)
      byRef.set(issue.refId, list)
      if (issue.severity === 'error' && issue.refId !== '') invalid.add(issue.refId)
    }
    return { issuesByRef: byRef, invalidNodeIds: invalid }
  }, [validation])

  const orphanNodeIds = useMemo(() => {
    const { orphanNodeIds: orphans } = compileFlow({ meta, options, nodes, edges })
    return new Set(orphans)
  }, [meta, options, nodes, edges])

  const selectIssueNode = (issue: ValidationIssue): void => {
    if (issue.refId === '') return
    useProjectStore.setState((state) => ({
      suites: state.suites.map((suite) =>
        suite.id === state.activeSuiteId
          ? { ...suite, nodes: suite.nodes.map((node) => ({ ...node, selected: node.id === issue.refId })) }
          : suite
      )
    }))
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <div className='flex min-h-0 flex-1'>
        {/* Left rail: the suite's workloads, then the parts a journey is built from */}
        <aside
          className='flex w-72 shrink-0 flex-col overflow-hidden border-r border-border bg-background/60'
          aria-label='Scenarios and components'
        >
          <ScenarioPanel invalidNodeIds={invalidNodeIds} />
          <BuilderSidebar />
        </aside>

        <div className='flex min-w-0 flex-1 flex-col'>
          <ScenarioTimeline />
          <ReactFlowProvider>
            <BuilderCanvas invalidNodeIds={invalidNodeIds} orphanNodeIds={orphanNodeIds} />
          </ReactFlowProvider>
        </div>

        <PropertiesPanel selected={selected} issuesByRef={issuesByRef} />
      </div>

      {/* Validation status bar */}
      <div className='shrink-0 border-t border-border bg-card'>
        <button
          onClick={() => setIssuesOpen((open) => !open)}
          className='flex w-full items-center gap-3 px-4 py-2 text-left cursor-pointer'
          aria-expanded={issuesOpen}
          aria-controls='validation-issues'
        >
          {validation.valid ? (
            <span className='flex items-center gap-1.5 text-xs font-medium text-success'>
              <CheckCircle2 className='size-4' aria-hidden />
              Test configuration is valid — export is enabled
            </span>
          ) : (
            <span className='flex items-center gap-1.5 text-xs font-medium text-destructive'>
              <XCircle className='size-4' aria-hidden />
              {validation.errors.length} error{validation.errors.length === 1 ? '' : 's'} blocking export
            </span>
          )}
          {validation.warnings.length > 0 && (
            <Badge variant='warning'>
              <AlertTriangle className='size-3' aria-hidden />
              {validation.warnings.length} warning{validation.warnings.length === 1 ? '' : 's'}
            </Badge>
          )}
          {orphanNodeIds.size > 0 && (
            <Badge variant='outline'>
              {orphanNodeIds.size} unconnected node{orphanNodeIds.size === 1 ? '' : 's'} ignored
            </Badge>
          )}
          <ChevronUp
            className={cn(
              'ml-auto size-4 text-muted-foreground transition-transform',
              issuesOpen && 'rotate-180'
            )}
            aria-hidden
          />
        </button>

        <AnimatePresence>
          {issuesOpen && (
            <motion.div
              id='validation-issues'
              initial={{ height: 0 }}
              animate={{ height: 'auto' }}
              exit={{ height: 0 }}
              transition={{ duration: 0.18 }}
              className='overflow-hidden'
            >
              <ul className='max-h-48 space-y-1 overflow-y-auto border-t border-border px-4 py-2'>
                {validation.issues.length === 0 && (
                  <li className='py-2 text-xs text-muted-foreground'>No issues. Nice work — ship it. 🚀</li>
                )}
                {validation.issues.map((issue) => (
                  <li key={issue.id}>
                    <button
                      onClick={() => selectIssueNode(issue)}
                      className={cn(
                        'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted',
                        issue.refId !== '' && 'cursor-pointer'
                      )}
                    >
                      {issue.severity === 'error' ? (
                        <XCircle className='mt-0.5 size-3.5 shrink-0 text-destructive' aria-hidden />
                      ) : (
                        <AlertTriangle className='mt-0.5 size-3.5 shrink-0 text-warning' aria-hidden />
                      )}
                      <span>
                        <span className='font-medium'>{issue.message}</span>
                        <span className='block text-muted-foreground'>💡 {issue.fix}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
