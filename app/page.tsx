'use client'

import { Gauge } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useAuthStore } from '@/stores/auth-store'

export default function IndexPage(): React.ReactNode {
  const router = useRouter()
  const authenticated = useAuthStore((state) => state.authenticated)

  useEffect(() => {
    router.replace(authenticated ? '/studio' : '/login')
  }, [authenticated, router])

  return (
    <main className='flex flex-1 items-center justify-center' aria-busy>
      <div className='flex items-center gap-3 text-muted-foreground'>
        <Gauge className='size-6 animate-pulse text-primary' aria-hidden />
        <span className='text-sm'>Loading K6 Studio Builder…</span>
      </div>
    </main>
  )
}
