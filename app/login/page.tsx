'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { motion } from 'framer-motion'
import { Gauge, KeyRound, LogIn, User } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { ThemeSwitcher } from '@/components/theme/theme-switcher'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuthStore } from '@/stores/auth-store'
import { authenticate } from './actions'

const loginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required')
})

type LoginValues = z.infer<typeof loginSchema>

export default function LoginPage(): React.ReactNode {
  const router = useRouter()
  const login = useAuthStore((state) => state.login)
  const [failed, setFailed] = useState(false)

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: '', password: '' }
  })

  const onSubmit = async (values: LoginValues): Promise<void> => {
    setFailed(false)

    if (await authenticate(values.username, values.password)) {
      login()
      router.replace('/studio')
    } else {
      setFailed(true)
    }
  }

  return (
    <main className='relative flex flex-1 items-center justify-center p-4'>
      <div className='absolute right-4 top-4'>
        <ThemeSwitcher />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className='w-full max-w-sm'
      >
        <div className='mb-6 flex flex-col items-center gap-2 text-center'>
          <span className='flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg'>
            <Gauge className='size-6' aria-hidden />
          </span>
          <h1 className='text-xl font-semibold tracking-tight'>K6 Studio Builder</h1>
          <p className='text-sm text-muted-foreground'>Visual load test designer for Grafana k6</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>Use your workspace credentials to continue.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4' noValidate>
              <div className='space-y-1.5'>
                <Label htmlFor='username'>Username</Label>
                <div className='relative'>
                  <User
                    className='pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground'
                    aria-hidden
                  />
                  <Input
                    id='username'
                    autoComplete='username'
                    className='pl-9'
                    aria-invalid={form.formState.errors.username !== undefined}
                    {...form.register('username')}
                  />
                </div>
                {form.formState.errors.username !== undefined && (
                  <p className='text-xs text-destructive' role='alert'>
                    {form.formState.errors.username.message}
                  </p>
                )}
              </div>

              <div className='space-y-1.5'>
                <Label htmlFor='password'>Password</Label>
                <div className='relative'>
                  <KeyRound
                    className='pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground'
                    aria-hidden
                  />
                  <Input
                    id='password'
                    type='password'
                    autoComplete='current-password'
                    className='pl-9'
                    aria-invalid={form.formState.errors.password !== undefined}
                    {...form.register('password')}
                  />
                </div>
                {form.formState.errors.password !== undefined && (
                  <p className='text-xs text-destructive' role='alert'>
                    {form.formState.errors.password.message}
                  </p>
                )}
              </div>

              {failed && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className='rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive'
                  role='alert'
                >
                  Invalid credentials. Check your username and password.
                </motion.p>
              )}

              <Button type='submit' className='w-full' disabled={form.formState.isSubmitting}>
                <LogIn className='size-4' aria-hidden />
                {form.formState.isSubmitting ? 'Signing in...' : 'Sign in'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </motion.div>
    </main>
  )
}
