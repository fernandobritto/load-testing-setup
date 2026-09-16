'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronLeft, ChevronRight, Gauge, LogOut } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { StepBuilder } from '@/components/step2/step-builder'
import { StepImport } from '@/components/step1/step-import'
import { StepReview } from '@/components/step3/step-review'
import { SuiteBar } from '@/components/step2/suite-bar'
import { ThemeSwitcher } from '@/components/theme/theme-switcher'
import { Button } from '@/components/ui/button'
import { buildAllSuites } from '@/lib/export/build'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { selectActiveSuite, useProjectStore, type WizardStep } from '@/stores/project-store'

const STEPS: Array<{ step: WizardStep; label: string; description: string }> = [
  { step: 1, label: 'Import', description: 'Project & cURL requests' },
  { step: 2, label: 'Design', description: 'Visual K6 builder' },
  { step: 3, label: 'Export', description: 'Review & generate' }
]

export default function StudioPage(): React.ReactNode {
  const router = useRouter()
  const authenticated = useAuthStore((state) => state.authenticated)
  const logout = useAuthStore((state) => state.logout)
  const step = useProjectStore((state) => state.step)
  const setStep = useProjectStore((state) => state.setStep)
  const meta = useProjectStore((state) => state.meta)
  const requests = useProjectStore((state) => state.requests)
  const suites = useProjectStore((state) => state.suites)
  const activeSuiteId = useProjectStore((state) => state.activeSuiteId)
  const activeSuite = useProjectStore(selectActiveSuite)

  /* Avoid hydration mismatches: persisted stores only render after mount */
  const mounted = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false
  )

  useEffect(() => {
    if (mounted && !authenticated) router.replace('/login')
  }, [mounted, authenticated, router])

  /* Build every suite once per change; drives validation badges + export. */
  const builds = useMemo(() => buildAllSuites(meta, suites), [meta, suites])
  const activeBuild = builds.find((build) => build.suite.id === activeSuiteId) ?? builds[0]
  const validityBySuite = useMemo(
    () => new Map(builds.map((build) => [build.suite.id, build.validation.valid])),
    [builds]
  )
  const allValid = builds.length > 0 && builds.every((build) => build.validation.valid)

  if (!mounted || !authenticated) {
    return (
      <main className='flex flex-1 items-center justify-center' aria-busy>
        <Gauge className='size-7 animate-pulse text-primary' aria-hidden />
      </main>
    )
  }

  const canGoNext = step === 1 ? meta.name.trim() !== '' && requests.length > 0 : step === 2

  const nextDisabledReason =
    step === 1
      ? meta.name.trim() === ''
        ? 'Name the project to continue'
        : requests.length === 0
          ? 'Import at least one request to continue'
          : ''
      : ''

  return (
    <div className='flex h-dvh flex-col overflow-hidden'>
      {/* Top bar */}
      <header className='flex h-16 shrink-0 items-center gap-4 border-b border-border bg-card px-5'>
        <div className='flex items-center gap-3'>
          <span className='flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm'>
            <Gauge className='size-5' aria-hidden />
          </span>
          <div className='leading-tight'>
            <p className='text-[15px] font-semibold'>K6 Studio Builder</p>
            <p className='max-w-48 truncate text-xs text-muted-foreground'>
              {meta.name === '' ? 'Untitled project' : meta.name}
            </p>
          </div>
        </div>

        {/* Stepper */}
        <nav className='mx-auto hidden items-center gap-1 md:flex' aria-label='Wizard progress'>
          {STEPS.map((item, index) => {
            const isActive = item.step === step
            const isDone = item.step < step
            return (
              <div key={item.step} className='flex items-center'>
                {index > 0 && (
                  <div
                    className={cn(
                      'mx-2 h-px w-10 transition-colors',
                      isDone || isActive ? 'bg-primary' : 'bg-border'
                    )}
                  />
                )}
                <button
                  onClick={() => {
                    if (item.step < step || canGoNext || item.step === step) setStep(item.step)
                  }}
                  className={cn(
                    'flex items-center gap-2 rounded-full px-3.5 py-2 text-sm transition-colors cursor-pointer',
                    isActive
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                  aria-current={isActive ? 'step' : undefined}
                >
                  <span
                    className={cn(
                      'flex size-5 items-center justify-center rounded-full text-[11px] font-semibold transition-colors',
                      isActive || isDone
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground'
                    )}
                  >
                    {isDone ? <Check className='size-3' aria-hidden /> : item.step}
                  </span>
                  <span className='hidden lg:inline'>{item.label}</span>
                </button>
              </div>
            )
          })}
        </nav>

        <div className='ml-auto flex items-center gap-1'>
          {step > 1 && (
            <Button variant='ghost' size='sm' onClick={() => setStep((step - 1) as WizardStep)}>
              <ChevronLeft className='size-4' aria-hidden />
              Back
            </Button>
          )}
          {step < 3 && (
            <Button
              size='sm'
              onClick={() => setStep((step + 1) as WizardStep)}
              disabled={!canGoNext}
              title={nextDisabledReason}
            >
              {step === 1 ? 'Design test' : 'Review & export'}
              <ChevronRight className='size-4' aria-hidden />
            </Button>
          )}
          <div className='mx-1 h-6 w-px bg-border' aria-hidden />
          <ThemeSwitcher />
          <Button
            variant='ghost'
            size='icon'
            aria-label='Sign out'
            onClick={() => {
              logout()
              router.replace('/login')
            }}
          >
            <LogOut className='size-4' aria-hidden />
          </Button>
        </div>
      </header>

      {/* Suite bar — visible while designing and exporting */}
      {step > 1 && <SuiteBar validityBySuite={validityBySuite} />}

      {/* Step content */}
      <AnimatePresence mode='wait'>
        <motion.main
          key={step}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className='flex min-h-0 flex-1 flex-col'
        >
          {step === 1 && <StepImport />}
          {step === 2 && <StepBuilder key={activeSuite.id} validation={activeBuild.validation} />}
          {step === 3 && <StepReview builds={builds} allValid={allValid} />}
        </motion.main>
      </AnimatePresence>
    </div>
  )
}
