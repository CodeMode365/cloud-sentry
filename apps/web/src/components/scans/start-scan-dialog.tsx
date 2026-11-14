'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { LoaderCircle, Play } from 'lucide-react';
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
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAccounts, useStartScan } from '@/lib/queries';

export function StartScanDialog() {
  const router = useRouter();
  const accounts = useAccounts();
  const start = useStartScan();
  const [open, setOpen] = React.useState(false);
  const connected = (accounts.data ?? []).filter((a) => a.status === 'CONNECTED');
  const [accountId, setAccountId] = React.useState<string>('');
  const submit = async () => {
    if (!accountId) return;
    const scan = await start.mutateAsync({ accountId });
    toast.success('Scan started');
    setOpen(false);
    router.push(`/scans/detail/?id=${encodeURIComponent(scan.scanId)}`);
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Play /> Start scan
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start a manual scan</DialogTitle>
          <DialogDescription>
            Runs discovery, metric collection, cost analysis and detection for the account&apos;s configured
            regions.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="scan-account">Account</Label>
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger id="scan-account">
              <SelectValue placeholder={connected.length ? 'Select an account' : 'No connected accounts'} />
            </SelectTrigger>
            <SelectContent>
              {connected.map((a) => (
                <SelectItem key={a.accountId} value={a.accountId}>
                  {a.alias} ({a.accountId})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!accountId || start.isPending}>
            {start.isPending ? <LoaderCircle className="animate-spin" /> : <Play />} Start scan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
