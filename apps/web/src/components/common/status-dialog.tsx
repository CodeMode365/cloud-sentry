'use client';

import * as React from 'react';
import { LoaderCircle } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

/** Button that opens a dialog collecting an optional note before applying a status change. */
export function StatusChangeButton({
  label,
  title,
  description,
  icon,
  variant = 'outline',
  size = 'sm',
  onConfirm,
  pending,
}: {
  label: string;
  title: string;
  description: string;
  icon?: React.ReactNode;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  onConfirm: (note: string | undefined) => Promise<unknown>;
  pending?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [note, setNote] = React.useState('');
  const id = React.useId();
  const submit = async () => {
    try {
      await onConfirm(note.trim() || undefined);
      setOpen(false);
      setNote('');
    } catch {
      // Error toast is raised by the mutation cache; keep the dialog open for retry.
    }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size={size}>
          {icon}
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor={id}>Note (optional)</Label>
          <Textarea
            id={id}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
            placeholder="Why are you making this change?"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending && <LoaderCircle className="animate-spin" />}
            {label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
