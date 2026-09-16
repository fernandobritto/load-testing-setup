'use client'

import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { createKeyValue } from '@/lib/dsl/defaults'
import type { KeyValue } from '@/lib/dsl/types'

interface KeyValueEditorProps {
  items: KeyValue[]
  onChange: (items: KeyValue[]) => void
  keyPlaceholder?: string
  valuePlaceholder?: string
  addLabel?: string
}

export function KeyValueEditor({
  items,
  onChange,
  keyPlaceholder = 'Name',
  valuePlaceholder = 'Value',
  addLabel = 'Add entry'
}: KeyValueEditorProps): React.ReactNode {
  const update = (id: string, patch: Partial<KeyValue>): void => {
    onChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  return (
    <div className='space-y-1.5'>
      {items.map((item) => (
        <div key={item.id} className='flex items-center gap-1.5'>
          <Switch
            checked={item.enabled}
            onCheckedChange={(enabled) => update(item.id, { enabled })}
            aria-label={`Toggle ${item.key === '' ? 'entry' : item.key}`}
          />
          <Input
            value={item.key}
            onChange={(event) => update(item.id, { key: event.target.value })}
            placeholder={keyPlaceholder}
            aria-label={keyPlaceholder}
            className='h-8 flex-1 font-mono text-xs'
          />
          <Input
            value={item.value}
            onChange={(event) => update(item.id, { value: event.target.value })}
            placeholder={valuePlaceholder}
            aria-label={valuePlaceholder}
            className='h-8 flex-[1.4] font-mono text-xs'
          />
          <Button
            variant='ghost'
            size='icon'
            className='size-8 text-muted-foreground hover:text-destructive'
            onClick={() => onChange(items.filter((entry) => entry.id !== item.id))}
            aria-label={`Remove ${item.key === '' ? 'entry' : item.key}`}
          >
            <Trash2 className='size-3.5' aria-hidden />
          </Button>
        </div>
      ))}
      <Button variant='outline' size='sm' onClick={() => onChange([...items, createKeyValue()])}>
        <Plus className='size-3.5' aria-hidden />
        {addLabel}
      </Button>
    </div>
  )
}
