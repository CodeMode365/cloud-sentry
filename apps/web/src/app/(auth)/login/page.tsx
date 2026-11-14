'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { LoaderCircle } from 'lucide-react';
import type { LoginResponse } from '@cloudsentry/shared-types';
import { loginRequestSchema, type LoginRequest } from '@cloudsentry/validators';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ApiError, errorMessage, request } from '@/lib/api';
import { useSession } from '@/lib/auth-store';

export default function LoginPage() {
  const router = useRouter();
  const setSession = useSession((s) => s.setSession);
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<LoginRequest>({
    resolver: zodResolver(loginRequestSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (values: LoginRequest) => {
    setError(null);
    try {
      const res = await request<LoginResponse>('POST', '/auth/login', {
        body: values,
        anonymous: true,
        noAuthRetry: true,
      });
      setSession({
        accessToken: res.accessToken,
        expiresIn: res.expiresIn,
        user: res.user,
        tenant: res.tenant,
      });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'USER_NOT_CONFIRMED') {
        router.push(`/confirm/?email=${encodeURIComponent(values.email)}`);
        return;
      }
      setError(errorMessage(e));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Sign in</CardTitle>
        <CardDescription>Access your CloudSentry workspace.</CardDescription>
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
          <Field id="password" label="Password" error={form.formState.errors.password?.message}>
            <Input type="password" autoComplete="current-password" {...form.register('password')} />
          </Field>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && <LoaderCircle className="animate-spin" />}
            Sign in
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            New to CloudSentry?{' '}
            <Link href="/register/" className="font-medium text-primary hover:underline">
              Create an account
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
