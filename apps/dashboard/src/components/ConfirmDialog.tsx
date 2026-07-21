'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export interface ConfirmDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'destructive';
  pending?: boolean;
  acknowledgementLabel?: string;
  acknowledgementChecked?: boolean;
  onAcknowledgementChange?: (checked: boolean) => void;
}

export function ConfirmDialog({
  open,
  onConfirm,
  onCancel,
  title,
  description,
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  variant = 'default',
  pending = false,
  acknowledgementLabel,
  acknowledgementChecked = false,
  onAcknowledgementChange,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => (v || pending ? null : onCancel())}>
      <DialogContent className="max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="whitespace-pre-line">{description}</DialogDescription>
        </DialogHeader>
        {acknowledgementLabel ? (
          <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-3 text-sm text-foreground">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-border accent-primary"
              checked={acknowledgementChecked}
              disabled={pending}
              onChange={(event) => onAcknowledgementChange?.(event.target.checked)}
            />
            <span>{acknowledgementLabel}</span>
          </label>
        ) : null}
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={pending}
            className="transition-all duration-200"
          >
            {cancelLabel}
          </Button>
          <Button
            variant={variant === 'destructive' ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={pending || Boolean(acknowledgementLabel && !acknowledgementChecked)}
            className="transition-all duration-200"
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
