'use client'

import { Check, Palette } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { THEMES, useTheme, type ThemeId } from './theme-provider'

const SWATCHES: Record<ThemeId, string> = {
  light: 'linear-gradient(135deg, #f8fafc 50%, #4f46e5 50%)',
  dark: 'linear-gradient(135deg, #0b1120 50%, #6366f1 50%)',
  dracula: 'linear-gradient(135deg, #282a36 50%, #bd93f9 50%)',
  javascript: 'linear-gradient(135deg, #101010 50%, #f7df1e 50%)',
  aurora: 'linear-gradient(135deg, #061621 50%, #2dd4bf 50%)'
}

export function ThemeSwitcher(): React.ReactNode {
  const { theme, setTheme } = useTheme()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant='ghost' size='icon' aria-label='Switch theme'>
          <Palette className='size-4' aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        {THEMES.map((item) => (
          <DropdownMenuItem key={item.id} onSelect={() => setTheme(item.id)}>
            <span
              className='size-3.5 rounded-full border border-border'
              style={{ background: SWATCHES[item.id] }}
              aria-hidden
            />
            <span className='flex-1'>{item.label}</span>
            {theme === item.id && <Check className='size-4 text-primary' aria-hidden />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
