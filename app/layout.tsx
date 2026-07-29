import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { ThemeProvider, themeInitScript } from '@/components/theme/theme-provider'
import { TooltipProvider } from '@/components/ui/tooltip'
import './globals.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin']
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin']
})

export const metadata: Metadata = {
  title: {
    default: 'K6 Studio Builder',
    template: '%s · K6 Studio Builder'
  },
  description:
    'Visual K6 script builder and load test designer — import cURL commands, design scenarios on a canvas, and export production-ready k6 scripts.'
}

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode
}>): React.ReactNode {
  return (
    <html
      lang='en'
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className='flex min-h-full flex-col'>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <ThemeProvider>
          <TooltipProvider delayDuration={250}>{children}</TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
