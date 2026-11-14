'use client';

import * as React from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Button, type ButtonProps } from '@/components/ui/button';

export function CopyButton({
  value,
  label = 'Copy',
  iconOnly = false,
  ...props
}: { value: string; label?: string; iconOnly?: boolean } & Omit<ButtonProps, 'onClick' | 'value'>) {
  const [copied, setCopied] = React.useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Could not copy to clipboard');
    }
  };
  return (
    <Button
      variant="outline"
      size={iconOnly ? 'icon-sm' : 'sm'}
      onClick={onCopy}
      aria-label={iconOnly ? label : undefined}
      {...props}
    >
      {copied ? <Check /> : <Copy />}
      {!iconOnly && (copied ? 'Copied' : label)}
    </Button>
  );
}

export function CodeBlock({
  code,
  label,
  maxHeight = 'max-h-80',
}: {
  code: string;
  label: string;
  maxHeight?: string;
}) {
  return (
    <div className="relative rounded-md border bg-muted/50">
      <div className="flex items-center justify-between border-b px-3 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <CopyButton value={code} iconOnly label={`Copy ${label}`} />
      </div>
      <pre className={`${maxHeight} overflow-auto p-3 text-xs leading-relaxed`}>
        <code>{code}</code>
      </pre>
    </div>
  );
}
