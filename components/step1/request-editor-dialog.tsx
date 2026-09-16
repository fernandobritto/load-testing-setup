'use client'

import { RequestEditor } from '@/components/shared/request-editor'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { HttpRequestDef } from '@/lib/dsl/types'
import { useProjectStore } from '@/stores/project-store'

interface RequestEditorDialogProps {
  request: HttpRequestDef
  onClose: () => void
}

export function RequestEditorDialog({ request, onClose }: RequestEditorDialogProps): React.ReactNode {
  const updateRequest = useProjectStore((state) => state.updateRequest)

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className='max-h-[85dvh] max-w-2xl overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>Edit request</DialogTitle>
          <DialogDescription>
            Changes apply to the request library; nodes already on the canvas keep their own copy.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-1.5'>
          <Label htmlFor='request-name'>Name</Label>
          <Input
            id='request-name'
            value={request.name}
            onChange={(event) => updateRequest(request.id, { name: event.target.value })}
          />
        </div>

        <RequestEditor request={request} onChange={(patch) => updateRequest(request.id, patch)} />
      </DialogContent>
    </Dialog>
  )
}
