'use client';

import * as React from 'react';
import { LoaderCircle, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useUpdateAccount } from '@/lib/queries';
import type { CloudAccount } from '@cloudsentry/shared-types';

const MAX_ALIAS_LENGTH = 64;

/** Renames a connected account (its CloudSentry display name; nothing changes in AWS). */
export function RenameAccountDialog({
  account,
  size = 'icon',
}: {
  account: Pick<CloudAccount, 'accountId' | 'alias'>;
  /** `icon` renders a compact pencil button; `button` renders a labelled button. */
  size?: 'icon' | 'button';
}) {
  const update = useUpdateAccount(account.accountId);
  const [open, setOpen] = React.useState(false);
  const [alias, setAlias] = React.useState(account.alias);

  React.useEffect(() => {
    if (open) setAlias(account.alias);
  }, [open, account.alias]);

  const trimmed = alias.trim();
  const invalid = trimmed.length === 0 || trimmed.length > MAX_ALIAS_LENGTH;
  const unchanged = trimmed === account.alias;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (invalid || unchanged) return;
    try {
      await update.mutateAsync({ alias: trimmed });
      toast.success('Account renamed');
      setOpen(false);
    } catch {
      // The global mutation error handler already shows the API error; keep the dialog open to retry.
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {size === 'icon' ? (
          <Button variant="ghost" size="icon" aria-label={`Rename ${account.alias}`} title="Rename account">
            <Pencil />
          </Button>
        ) : (
          <Button variant="outline">
            <Pencil /> Rename
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={(e) => void submit(e)} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Rename account</DialogTitle>
            <DialogDescription>
              Change the display name used in CloudSentry for AWS account{' '}
              <span className="font-mono">{account.accountId}</span>. Nothing changes in AWS.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <label htmlFor={`rename-${account.accountId}`} className="text-sm font-medium">
              Display name
            </label>
            <Input
              id={`rename-${account.accountId}`}
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              maxLength={MAX_ALIAS_LENGTH}
              autoFocus
              aria-invalid={invalid}
              aria-describedby={`rename-${account.accountId}-hint`}
            />
            <p id={`rename-${account.accountId}-hint`} className="text-xs text-muted-foreground">
              {trimmed.length === 0
                ? 'A display name is required.'
                : `${trimmed.length}/${MAX_ALIAS_LENGTH} characters`}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={invalid || unchanged || update.isPending}>
              {update.isPending && <LoaderCircle className="animate-spin" />} Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
