'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { LoaderCircle, MailCheck } from 'lucide-react';
import { toast } from 'sonner';
import { confirmRegistrationRequestSchema, type ConfirmRegistrationRequest } from '@cloudsentry/validators';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { errorMessage, request } from '@/lib/api';

function ConfirmForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = React.useState<string | null>(null);
  const [resending, setResending] = React.useState(false);
  const form = useForm<ConfirmRegistrationRequest>({
    resolver: zodResolver(confirmRegistrationRequestSchema),
    defaultValues: { email: params.get('email') ?? '', code: '' },
  });

  const onSubmit = async (values: ConfirmRegistrationRequest) => {
    setError(null);
    try {
      await request<unknown>('POST', '/auth/confirm', { body: values, anonymous: true, noAuthRetry: true });
      toast.success('Email confirmed. You can now sign in.');
      router.push('/login/');
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const resend = async () => {
    const email = form.getValues('email');
    if (!email) {
      form.setError('email', { message: 'Enter your email to resend the code' });
      return;
    }
    setResending(true);
    try {
      await request<unknown>('POST', '/auth/resend-code', {
        body: { email },
        anonymous: true,
        noAuthRetry: true,
      });
      toast.success('A new confirmation code was sent.');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setResending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
          <MailCheck className="size-5" aria-hidden />
        </div>
        <CardTitle className="text-xl">Confirm your email</CardTitle>
        <CardDescription>Enter the verification code we emailed to you.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
          {error && (
            <Alert variant="destructive">
              <AlertDescription className="text-destructive">{error}</AlertDescription>
            </Alert>
          )}
          <Field id="email" label="Email" error={form.formState.errors.email?.message}>
            <Input type="email" autoComplete="email" {...form.register('email')} />
          </Field>
          <Field id="code" label="Confirmation code" error={form.formState.errors.code?.message}>
            <Input inputMode="numeric" autoComplete="one-time-code" {...form.register('code')} />
          </Field>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && <LoaderCircle className="animate-spin" />}
            Confirm email
          </Button>
          <div className="flex items-center justify-between text-sm">
            <Button
              type="button"
              variant="link"
              className="h-auto px-0"
              onClick={resend}
              disabled={resending}
            >
              Resend code
            </Button>
            <Link href="/login/" className="text-muted-foreground hover:underline">
              Back to sign in
            </Link>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export default function ConfirmPage() {
  return (
    <React.Suspense fallback={null}>
      <ConfirmForm />
    </React.Suspense>
  );
}
