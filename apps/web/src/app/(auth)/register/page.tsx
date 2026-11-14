'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { LoaderCircle } from 'lucide-react';
import { registerRequestSchema, type RegisterRequest } from '@cloudsentry/validators';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { errorMessage, request } from '@/lib/api';

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<RegisterRequest>({
    resolver: zodResolver(registerRequestSchema),
    defaultValues: { email: '', password: '', name: '', organizationName: '' },
  });
  const errors = form.formState.errors;

  const onSubmit = async (values: RegisterRequest) => {
    setError(null);
    try {
      await request<unknown>('POST', '/auth/register', { body: values, anonymous: true, noAuthRetry: true });
      router.push(`/confirm/?email=${encodeURIComponent(values.email)}`);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Create your workspace</CardTitle>
        <CardDescription>
          CloudSentry connects to AWS with a read-only role. No credentials are stored.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
          {error && (
            <Alert variant="destructive">
              <AlertDescription className="text-destructive">{error}</AlertDescription>
            </Alert>
          )}
          <Field id="name" label="Your name" error={errors.name?.message} required>
            <Input autoComplete="name" {...form.register('name')} />
          </Field>
          <Field id="organizationName" label="Organization" error={errors.organizationName?.message} required>
            <Input autoComplete="organization" {...form.register('organizationName')} />
          </Field>
          <Field id="email" label="Work email" error={errors.email?.message} required>
            <Input type="email" autoComplete="email" {...form.register('email')} />
          </Field>
          <Field
            id="password"
            label="Password"
            error={errors.password?.message}
            hint="At least 12 characters with upper and lower case letters, a digit and a symbol."
            required
          >
            <Input type="password" autoComplete="new-password" {...form.register('password')} />
          </Field>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && <LoaderCircle className="animate-spin" />}
            Create account
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Already registered?{' '}
            <Link href="/login/" className="font-medium text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
