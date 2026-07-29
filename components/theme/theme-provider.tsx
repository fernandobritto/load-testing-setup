'use client'

import { createContext, useCallback, useContext, useSyncExternalStore, type ReactNode } from 'react'

export const THEMES = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'dracula', label: 'Dracula' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'aurora', label: 'Aurora' }
] as const

export type ThemeId = (typeof THEMES)[number]['id']

const STORAGE_KEY = 'k6-studio-theme'

interface ThemeContextValue {
  theme: ThemeId
  setTheme: (theme: ThemeId) => void
}

const ThemeContext = createContext<ThemeContextValue>({ theme: 'dark', setTheme: () => undefined })

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext)
}

/** Monaco editor theme matching the active app theme */
export function monacoThemeFor(theme: ThemeId): 'vs' | 'vs-dark' {
  return theme === 'light' ? 'vs' : 'vs-dark'
}

const CHANGE_EVENT = 'k6-studio-theme-change'

function subscribeTheme(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}

function readTheme(): ThemeId {
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return stored !== null && THEMES.some((t) => t.id === stored) ? (stored as ThemeId) : 'dark'
}

export function ThemeProvider({ children }: { children: ReactNode }): ReactNode {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => 'dark' as ThemeId)

  const setTheme = useCallback((next: ThemeId) => {
    window.localStorage.setItem(STORAGE_KEY, next)
    document.documentElement.dataset.theme = next
    window.dispatchEvent(new Event(CHANGE_EVENT))
  }, [])

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>
}

/** Inline script that applies the stored theme before first paint (no FOUC) */
export const themeInitScript = `(function(){try{var t=localStorage.getItem('${STORAGE_KEY}');if(t){document.documentElement.dataset.theme=t}else{document.documentElement.dataset.theme='dark'}}catch(e){document.documentElement.dataset.theme='dark'}})()`
