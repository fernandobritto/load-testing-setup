'use client'

import { KeyValueEditor } from '@/components/shared/key-value-editor'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import type { AuthConfig, BodyMode, HttpMethod, HttpRequestDef } from '@/lib/dsl/types'
import { tryParseJson } from '@/lib/utils'

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
const BODY_MODES: Array<{ value: BodyMode; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'json', label: 'JSON' },
  { value: 'text', label: 'Raw text' },
  { value: 'form-urlencoded', label: 'Form URL-encoded' },
  { value: 'multipart', label: 'Multipart form' }
]

interface RequestEditorProps {
  request: HttpRequestDef
  onChange: (patch: Partial<HttpRequestDef>) => void
  compact?: boolean
}

export function RequestEditor({ request, onChange, compact = false }: RequestEditorProps): React.ReactNode {
  const jsonStatus =
    request.body.mode === 'json' && request.body.raw.trim() !== ''
      ? tryParseJson(request.body.raw.replace(/\{\{[^}]+\}\}/g, '"x"'))
      : null

  const setAuth = (auth: AuthConfig): void => onChange({ auth })

  return (
    <div className='space-y-4'>
      <div className='flex gap-2'>
        <div className='w-28 space-y-1.5'>
          <Label htmlFor={`method-${request.id}`}>Method</Label>
          <Select
            id={`method-${request.id}`}
            value={request.method}
            onChange={(event) => onChange({ method: event.target.value as HttpMethod })}
          >
            {METHODS.map((method) => (
              <option key={method} value={method}>
                {method}
              </option>
            ))}
          </Select>
        </div>
        <div className='flex-1 space-y-1.5'>
          <Label htmlFor={`url-${request.id}`}>URL</Label>
          <Input
            id={`url-${request.id}`}
            value={request.url}
            onChange={(event) => onChange({ url: event.target.value })}
            placeholder='https://api.example.com/users'
            className='font-mono text-xs'
          />
        </div>
      </div>

      <Tabs defaultValue='params'>
        <TabsList className='w-full justify-start overflow-x-auto'>
          <TabsTrigger value='params'>Params</TabsTrigger>
          <TabsTrigger value='headers'>Headers</TabsTrigger>
          <TabsTrigger value='cookies'>Cookies</TabsTrigger>
          <TabsTrigger value='body'>Body</TabsTrigger>
          <TabsTrigger value='auth'>Auth</TabsTrigger>
          {!compact && <TabsTrigger value='advanced'>Advanced</TabsTrigger>}
        </TabsList>

        <TabsContent value='params'>
          <KeyValueEditor
            items={request.params}
            onChange={(params) => onChange({ params })}
            keyPlaceholder='param'
            valuePlaceholder='value'
            addLabel='Add query param'
          />
        </TabsContent>

        <TabsContent value='headers'>
          <KeyValueEditor
            items={request.headers}
            onChange={(headers) => onChange({ headers })}
            keyPlaceholder='Header-Name'
            valuePlaceholder='value'
            addLabel='Add header'
          />
        </TabsContent>

        <TabsContent value='cookies'>
          <KeyValueEditor
            items={request.cookies}
            onChange={(cookies) => onChange({ cookies })}
            keyPlaceholder='cookie'
            valuePlaceholder='value'
            addLabel='Add cookie'
          />
        </TabsContent>

        <TabsContent value='body' className='space-y-3'>
          <Select
            value={request.body.mode}
            onChange={(event) =>
              onChange({ body: { ...request.body, mode: event.target.value as BodyMode } })
            }
            aria-label='Body mode'
          >
            {BODY_MODES.map((mode) => (
              <option key={mode.value} value={mode.value}>
                {mode.label}
              </option>
            ))}
          </Select>

          {(request.body.mode === 'json' || request.body.mode === 'text') && (
            <div className='space-y-1'>
              <Textarea
                value={request.body.raw}
                onChange={(event) => onChange({ body: { ...request.body, raw: event.target.value } })}
                rows={compact ? 6 : 9}
                spellCheck={false}
                className='font-mono text-xs leading-relaxed'
                aria-label='Request body'
                placeholder={request.body.mode === 'json' ? '{\n  "key": "value"\n}' : 'raw body…'}
              />
              {jsonStatus !== null && !jsonStatus.ok && (
                <p className='text-[11px] text-destructive' role='alert'>
                  Invalid JSON: {jsonStatus.error}
                </p>
              )}
            </div>
          )}

          {(request.body.mode === 'form-urlencoded' || request.body.mode === 'multipart') && (
            <>
              <KeyValueEditor
                items={request.body.fields}
                onChange={(fields) => onChange({ body: { ...request.body, fields } })}
                keyPlaceholder='field'
                valuePlaceholder={request.body.mode === 'multipart' ? 'value or @path/to/file' : 'value'}
                addLabel='Add field'
              />
              {request.body.mode === 'multipart' && (
                <p className='text-[11px] text-muted-foreground'>
                  Prefix a value with <code className='font-mono'>@</code> to upload a file — it is opened
                  with <code className='font-mono'>open()</code> in the generated script.
                </p>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value='auth' className='space-y-3'>
          <Select
            value={request.auth.type}
            onChange={(event) => {
              const type = event.target.value as AuthConfig['type']
              if (type === 'none') setAuth({ type: 'none' })
              if (type === 'bearer') setAuth({ type: 'bearer', token: '' })
              if (type === 'basic') setAuth({ type: 'basic', username: '', password: '' })
              if (type === 'api-key') setAuth({ type: 'api-key', headerName: 'X-API-Key', value: '' })
            }}
            aria-label='Authentication type'
          >
            <option value='none'>No authentication</option>
            <option value='bearer'>Bearer token</option>
            <option value='basic'>Basic auth</option>
            <option value='api-key'>API key header</option>
          </Select>

          {request.auth.type === 'bearer' && (
            <div className='space-y-1.5'>
              <Label>Token</Label>
              <Input
                value={request.auth.token}
                onChange={(event) => setAuth({ type: 'bearer', token: event.target.value })}
                placeholder='{{API_TOKEN}} or literal token'
                className='font-mono text-xs'
              />
            </div>
          )}
          {request.auth.type === 'basic' && (
            <div className='grid grid-cols-2 gap-2'>
              <div className='space-y-1.5'>
                <Label>Username</Label>
                <Input
                  value={request.auth.username}
                  onChange={(event) =>
                    setAuth({
                      type: 'basic',
                      username: event.target.value,
                      password: request.auth.type === 'basic' ? request.auth.password : ''
                    })
                  }
                  className='font-mono text-xs'
                />
              </div>
              <div className='space-y-1.5'>
                <Label>Password</Label>
                <Input
                  value={request.auth.password}
                  onChange={(event) =>
                    setAuth({
                      type: 'basic',
                      username: request.auth.type === 'basic' ? request.auth.username : '',
                      password: event.target.value
                    })
                  }
                  className='font-mono text-xs'
                />
              </div>
            </div>
          )}
          {request.auth.type === 'api-key' && (
            <div className='grid grid-cols-2 gap-2'>
              <div className='space-y-1.5'>
                <Label>Header name</Label>
                <Input
                  value={request.auth.headerName}
                  onChange={(event) =>
                    setAuth({
                      type: 'api-key',
                      headerName: event.target.value,
                      value: request.auth.type === 'api-key' ? request.auth.value : ''
                    })
                  }
                  className='font-mono text-xs'
                />
              </div>
              <div className='space-y-1.5'>
                <Label>Value</Label>
                <Input
                  value={request.auth.value}
                  onChange={(event) =>
                    setAuth({
                      type: 'api-key',
                      headerName: request.auth.type === 'api-key' ? request.auth.headerName : 'X-API-Key',
                      value: event.target.value
                    })
                  }
                  className='font-mono text-xs'
                />
              </div>
            </div>
          )}
          <p className='text-[11px] text-muted-foreground'>
            Use <code className='font-mono'>{'{{VAR}}'}</code> placeholders to reference environment variables
            or values extracted from previous responses.
          </p>
        </TabsContent>

        {!compact && (
          <TabsContent value='advanced' className='space-y-3'>
            <div className='w-40 space-y-1.5'>
              <Label>Timeout</Label>
              <Input
                value={request.timeout}
                onChange={(event) => onChange({ timeout: event.target.value })}
                placeholder='60s'
                className='font-mono text-xs'
              />
            </div>
            <div className='space-y-1.5'>
              <Label>Metric tags</Label>
              <KeyValueEditor
                items={request.tags}
                onChange={(tags) => onChange({ tags })}
                keyPlaceholder='tag'
                valuePlaceholder='value'
                addLabel='Add tag'
              />
            </div>
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
