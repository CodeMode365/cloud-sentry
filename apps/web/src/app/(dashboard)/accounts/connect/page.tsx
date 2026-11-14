'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, ArrowRight, CalendarClock, Check, LoaderCircle, Play, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import {
  CUSTOMER_ROLE_DEFAULT_NAME,
  type AccountOnboardingInstructions,
  type AccountVerificationResult,
  type CloudAccount,
} from '@cloudsentry/shared-types';
import { createAccountRequestSchema, type CreateAccountRequest, type z } from '@cloudsentry/validators';
import { OnboardingInstructions } from '@/components/accounts/onboarding-instructions';
import { VerificationResultView } from '@/components/accounts/verification-result';
import { PageHeader } from '@/components/common/page-header';
import { RegionMultiSelect } from '@/components/common/region-multi-select';
import { EmptyState, ErrorState, PageLoading } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { usePermissions } from '@/lib/permissions';
import {
  extractVerification,
  useAccount,
  useCreateAccount,
  useCreateSchedule,
  useOnboarding,
  useStartScan,
  useVerifyAccount,
} from '@/lib/queries';
import { cn } from '@/lib/utils';

const STEPS = ['Account details', 'Create IAM role', 'Verify connection', 'Start scanning'] as const;

function Stepper({ current }: { current: number }) {
  return (
    <ol className="mb-6 grid gap-2 sm:grid-cols-4" aria-label="Connection steps">
      {STEPS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li
            key={label}
            aria-current={active ? 'step' : undefined}
            className={cn(
              'flex items-center gap-2 rounded-md border px-3 py-2 text-sm',
              active && 'border-primary bg-primary/5',
              done && 'text-muted-foreground',
            )}
          >
            <span
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
                active && 'border-primary bg-primary text-primary-foreground',
                done && 'border-success bg-success text-success-foreground',
              )}
            >
              {done ? <Check className="size-3.5" aria-hidden /> : i + 1}
            </span>
            {label}
          </li>
        );
      })}
    </ol>
  );
}

type FormInput = z.input<typeof createAccountRequestSchema>;

function DetailsStep({
  onCreated,
}: {
  onCreated: (account: CloudAccount, onboarding: AccountOnboardingInstructions) => void;
}) {
  const create = useCreateAccount();
  const form = useForm<FormInput, unknown, CreateAccountRequest>({
    resolver: zodResolver(createAccountRequestSchema),
    defaultValues: { accountId: '', alias: '', roleName: CUSTOMER_ROLE_DEFAULT_NAME, regions: ['us-east-1'] },
  });
  const errors = form.formState.errors;
  const onSubmit = async (values: CreateAccountRequest) => {
    const res = await create.mutateAsync(values);
    onCreated(res.account, res.onboarding);
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Account details</CardTitle>
        <CardDescription>
          CloudSentry generates a unique external ID for this account. You will create the IAM role in the
          next step.
        </CardDescription>
      </CardHeader>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field
            id="accountId"
            label="AWS account ID"
            error={errors.accountId?.message}
            hint="12 digits"
            required
          >
            <Input inputMode="numeric" placeholder="123456789012" {...form.register('accountId')} />
          </Field>
          <Field id="alias" label="Display name" error={errors.alias?.message} required>
            <Input placeholder="Production" {...form.register('alias')} />
          </Field>
          <Field
            id="roleName"
            label="IAM role name"
            error={errors.roleName?.message}
            hint='Must start with "CloudSentry".'
          >
            <Input {...form.register('roleName')} />
          </Field>
          <div className="grid gap-1.5">
            <label htmlFor="regions" className="text-sm font-medium">
              Regions to scan
            </label>
            <Controller
              control={form.control}
              name="regions"
              render={({ field }) => (
                <RegionMultiSelect
                  id="regions"
                  value={field.value ?? []}
                  onChange={field.onChange}
                  invalid={!!errors.regions}
                />
              )}
            />
            {errors.regions && (
              <p className="text-xs text-destructive">{errors.regions.message ?? 'Invalid regions'}</p>
            )}
          </div>
        </CardContent>
        <CardFooter className="mt-4 justify-between">
          <Button variant="ghost" asChild>
            <Link href="/accounts/">
              <ArrowLeft /> Cancel
            </Link>
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? <LoaderCircle className="animate-spin" /> : null}
            Continue <ArrowRight />
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function VerifyStep({
  account,
  onboarding,
  onVerified,
  onBack,
}: {
  account: CloudAccount;
  onboarding: AccountOnboardingInstructions;
  onVerified: () => void;
  onBack: () => void;
}) {
  const verify = useVerifyAccount(account.accountId);
  const [roleArn, setRoleArn] = React.useState(account.roleArn || onboarding.roleArn);
  const [result, setResult] = React.useState<AccountVerificationResult | null>(account.lastVerification);
  const run = async () => {
    const res = await verify.mutateAsync(roleArn && roleArn !== account.roleArn ? { roleArn } : {});
    const v = extractVerification(res);
    setResult(v);
    if (v?.success) toast.success('Account connected');
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Verify connection</CardTitle>
        <CardDescription>
          CloudSentry assumes the role with the external ID, confirms the account ID matches, and probes each
          read-only permission.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field
          id="roleArn"
          label="Role ARN"
          hint="Change only if you created the role with a different name or path."
        >
          <Input value={roleArn} onChange={(e) => setRoleArn(e.target.value)} className="font-mono text-xs" />
        </Field>
        {result && <VerificationResultView result={result} />}
      </CardContent>
      <CardFooter className="mt-2 justify-between">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft /> Back to setup
        </Button>
        <div className="flex gap-2">
          <Button variant={result?.success ? 'outline' : 'default'} onClick={run} disabled={verify.isPending}>
            {verify.isPending ? <LoaderCircle className="animate-spin" /> : <ShieldCheck />}
            {result ? 'Verify again' : 'Verify connection'}
          </Button>
          {result?.success && (
            <Button onClick={onVerified}>
              Continue <ArrowRight />
            </Button>
          )}
        </div>
      </CardFooter>
    </Card>
  );
}

function DoneStep({ account }: { account: CloudAccount }) {
  const router = useRouter();
  const startScan = useStartScan();
  const createSchedule = useCreateSchedule();
  const { canOperate } = usePermissions();
  const [scheduled, setScheduled] = React.useState(false);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  const scan = async () => {
    const s = await startScan.mutateAsync({ accountId: account.accountId });
    toast.success('Scan started');
    router.push(`/scans/detail/?id=${encodeURIComponent(s.scanId)}`);
  };
  const schedule = async () => {
    await createSchedule.mutateAsync({
      accountId: account.accountId,
      frequency: 'DAILY',
      hour: 2,
      minute: 0,
      dayOfWeek: 2,
      timezone,
      enabled: true,
    });
    setScheduled(true);
    toast.success('Daily scan scheduled');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{account.alias} is connected</CardTitle>
        <CardDescription>
          Run the first scan now. Discovery, metric collection and cost analysis usually take a few minutes.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-md border p-4">
          <Play className="mb-2 size-5 text-primary" aria-hidden />
          <h4 className="font-medium">Start the first scan</h4>
          <p className="mb-3 text-sm text-muted-foreground">
            Scans the selected regions: {account.regions.join(', ')}.
          </p>
          <Button onClick={scan} disabled={!canOperate || startScan.isPending}>
            {startScan.isPending ? <LoaderCircle className="animate-spin" /> : <Play />}
            Start scan
          </Button>
        </div>
        <div className="rounded-md border p-4">
          <CalendarClock className="mb-2 size-5 text-primary" aria-hidden />
          <h4 className="font-medium">Schedule daily scans (optional)</h4>
          <p className="mb-3 text-sm text-muted-foreground">
            Daily at 02:00 {timezone}. You can change this later in Settings → Schedules.
          </p>
          <Button variant="outline" onClick={schedule} disabled={scheduled || createSchedule.isPending}>
            {scheduled ? (
              <Check />
            ) : createSchedule.isPending ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <CalendarClock />
            )}
            {scheduled ? 'Scheduled' : 'Schedule daily scans'}
          </Button>
        </div>
      </CardContent>
      <CardFooter className="mt-2">
        <Button variant="ghost" asChild>
          <Link href={`/accounts/detail/?id=${account.accountId}`}>Go to account</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

function Wizard() {
  const params = useSearchParams();
  const resumeId = params.get('id');
  const { canManage } = usePermissions();
  const resumeAccount = useAccount(resumeId);
  const resumeOnboarding = useOnboarding(resumeId);
  const [step, setStep] = React.useState(0);
  const [account, setAccount] = React.useState<CloudAccount | null>(null);
  const [onboarding, setOnboarding] = React.useState<AccountOnboardingInstructions | null>(null);

  React.useEffect(() => {
    if (resumeId && resumeAccount.data && resumeOnboarding.data && !account) {
      setAccount(resumeAccount.data);
      setOnboarding(resumeOnboarding.data);
      setStep(1);
    }
  }, [resumeId, resumeAccount.data, resumeOnboarding.data, account]);

  if (!canManage) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="Administrator access required"
        description="Only workspace owners and administrators can connect AWS accounts."
      />
    );
  }
  if (resumeId && (resumeAccount.isPending || resumeOnboarding.isPending)) return <PageLoading />;
  if (resumeId && (resumeAccount.isError || resumeOnboarding.isError)) {
    return <ErrorState error={resumeAccount.error ?? resumeOnboarding.error} />;
  }

  return (
    <>
      <PageHeader
        title="Connect an AWS account"
        description="Grant CloudSentry read-only access with a cross-account IAM role. No access keys are ever requested."
      />
      <Stepper current={step} />
      {step === 0 && (
        <DetailsStep
          onCreated={(a, o) => {
            setAccount(a);
            setOnboarding(o);
            setStep(1);
          }}
        />
      )}
      {step === 1 && account && onboarding && (
        <Card>
          <CardHeader>
            <CardTitle>Create the IAM role in {account.accountId}</CardTitle>
            <CardDescription>Use one of the options below, then continue to verification.</CardDescription>
          </CardHeader>
          <CardContent>
            <OnboardingInstructions onboarding={onboarding} />
          </CardContent>
          <CardFooter className="mt-2 justify-end">
            <Button onClick={() => setStep(2)}>
              I have created the role <ArrowRight />
            </Button>
          </CardFooter>
        </Card>
      )}
      {step === 2 && account && onboarding && (
        <VerifyStep
          account={account}
          onboarding={onboarding}
          onBack={() => setStep(1)}
          onVerified={() => setStep(3)}
        />
      )}
      {step === 3 && account && <DoneStep account={account} />}
    </>
  );
}

export default function ConnectAccountPage() {
  return (
    <React.Suspense fallback={<PageLoading />}>
      <Wizard />
    </React.Suspense>
  );
}
