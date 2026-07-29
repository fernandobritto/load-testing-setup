'use client'

import { AlertTriangle, FileJson, Import, TerminalSquare, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { RequestList } from '@/components/step1/request-list'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  isProjectExport,
  isSuiteExport,
  normalizeProjectImport,
  normalizeSuiteImport,
  useProjectStore
} from '@/stores/project-store'

const CURL_EXAMPLE = `curl -X POST https://api.example.com/auth/login \\
  -H 'Content-Type: application/json' \\
  -d '{"username": "alice", "password": "secret"}'

curl 'https://api.example.com/products?search=laptop&page=1' \\
  -H 'Accept: application/json'`

export function StepImport(): React.ReactNode {
  const meta = useProjectStore((state) => state.meta)
  const setMeta = useProjectStore((state) => state.setMeta)
  const curlText = useProjectStore((state) => state.curlText)
  const setCurlText = useProjectStore((state) => state.setCurlText)
  const curlErrors = useProjectStore((state) => state.curlErrors)
  const importCurl = useProjectStore((state) => state.importCurl)
  const importProject = useProjectStore((state) => state.importProject)
  const importSuite = useProjectStore((state) => state.importSuite)

  const [importedCount, setImportedCount] = useState<number | null>(null)
  const [projectImportError, setProjectImportError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleImport = (): void => {
    const count = importCurl()
    setImportedCount(count)
  }

  const handleProjectFile = async (file: File): Promise<void> => {
    try {
      const parsed: unknown = JSON.parse(await file.text())
      if (isSuiteExport(parsed)) {
        setProjectImportError('')
        importSuite(normalizeSuiteImport(parsed))
        return
      }
      if (!isProjectExport(parsed)) {
        setProjectImportError('This file is not a valid K6 Studio Builder project or suite export.')
        return
      }
      setProjectImportError('')
      importProject(normalizeProjectImport(parsed))
    } catch {
      setProjectImportError('Could not read the file — it does not contain valid JSON.')
    }
  }

  return (
    <div className='mx-auto grid w-full max-w-6xl flex-1 gap-6 overflow-y-auto p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]'>
      {/* Left column: project + curl */}
      <div className='space-y-6'>
        <Card>
          <CardHeader>
            <CardTitle>Project setup</CardTitle>
            <CardDescription>Describe the system under test.</CardDescription>
          </CardHeader>
          <CardContent className='space-y-4'>
            <div className='space-y-1.5'>
              <Label htmlFor='project-name'>Project name *</Label>
              <Input
                id='project-name'
                value={meta.name}
                onChange={(event) => setMeta({ name: event.target.value })}
                placeholder='Checkout API load tests'
              />
            </div>
            <div className='space-y-1.5'>
              <Label htmlFor='project-description'>Description</Label>
              <Textarea
                id='project-description'
                value={meta.description}
                onChange={(event) => setMeta({ description: event.target.value })}
                placeholder='What does this test suite cover, and why?'
                rows={2}
              />
            </div>
            <div className='space-y-1.5'>
              <Label htmlFor='project-base-url'>Global base URL (optional)</Label>
              <Input
                id='project-base-url'
                value={meta.baseUrl}
                onChange={(event) => setMeta({ baseUrl: event.target.value })}
                placeholder='https://api.example.com'
                className='font-mono text-xs'
              />
              <p className='text-[11px] text-muted-foreground'>
                Matching request URLs are rewritten to <code className='font-mono'>{'${BASE_URL}'}</code>,
                overridable with <code className='font-mono'>k6 run -e BASE_URL=…</code>
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className='flex items-start justify-between gap-2'>
              <div className='space-y-1'>
                <CardTitle className='flex items-center gap-2'>
                  <TerminalSquare className='size-4 text-primary' aria-hidden />
                  cURL importer
                </CardTitle>
                <CardDescription>
                  Paste one or many cURL commands — multi-line, separated by newlines, <code>;</code> or{' '}
                  <code>&amp;&amp;</code>.
                </CardDescription>
              </div>
              <Button
                variant='ghost'
                size='sm'
                onClick={() => setCurlText(CURL_EXAMPLE)}
                aria-label='Insert example cURL commands'
              >
                Example
              </Button>
            </div>
          </CardHeader>
          <CardContent className='space-y-3'>
            <Textarea
              value={curlText}
              onChange={(event) => setCurlText(event.target.value)}
              placeholder={
                'curl -X POST https://api.example.com/login \\\n  -H "Content-Type: application/json" \\\n  -d \'{"user": "alice"}\''
              }
              rows={10}
              spellCheck={false}
              className='font-mono text-xs leading-relaxed'
              aria-label='cURL commands'
            />
            <div className='flex items-center gap-2'>
              <Button onClick={handleImport} disabled={curlText.trim() === ''}>
                <Import className='size-4' aria-hidden />
                Parse &amp; import
              </Button>
              {importedCount !== null && curlErrors.length === 0 && importedCount > 0 && (
                <span className='text-xs text-success' role='status'>
                  Imported {importedCount} request{importedCount === 1 ? '' : 's'} ✓
                </span>
              )}
            </div>

            {curlErrors.length > 0 && (
              <div className='space-y-2' role='alert'>
                {curlErrors.map((error, indexNum) => (
                  <div
                    key={indexNum}
                    className='rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs'
                  >
                    <p className='flex items-center gap-1.5 font-medium text-destructive'>
                      <AlertTriangle className='size-3.5 shrink-0' aria-hidden />
                      Command {error.commandIndex}: {error.message}
                    </p>
                    <p className='mt-1 truncate font-mono text-muted-foreground'>{error.snippet}</p>
                    <p className='mt-1 text-foreground/80'>💡 {error.hint}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2'>
              <FileJson className='size-4 text-primary' aria-hidden />
              Import existing project
            </CardTitle>
            <CardDescription>Restore a project exported from K6 Studio Builder.</CardDescription>
          </CardHeader>
          <CardContent>
            <input
              ref={fileInputRef}
              type='file'
              accept='application/json,.json'
              className='sr-only'
              aria-label='Project JSON file'
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file !== undefined) void handleProjectFile(file)
                event.target.value = ''
              }}
            />
            <Button variant='outline' onClick={() => fileInputRef.current?.click()}>
              <Upload className='size-4' aria-hidden />
              Choose project.json
            </Button>
            {projectImportError !== '' && (
              <p className='mt-2 text-xs text-destructive' role='alert'>
                {projectImportError}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Right column: imported requests */}
      <RequestList />
    </div>
  )
}
