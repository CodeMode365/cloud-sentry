'use client';

import * as React from 'react';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { Toaster, toast } from 'sonner';
import { ApiError, errorMessage } from '@/lib/api';
import { TooltipProvider } from '@/components/ui/tooltip';

function makeQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache(),
    mutationCache: new MutationCache({
      onError: (error, _vars, _ctx, mutation) => {
        if (mutation.meta?.silent) return;
        toast.error(errorMessage(error));
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          if (
            error instanceof ApiError &&
            error.status >= 400 &&
            error.status < 500 &&
            error.status !== 429
          ) {
            return false;
          }
          return failureCount < 2;
        },
      },
    },
  });
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(makeQueryClient);
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          {children}
          <Toaster richColors closeButton position="top-right" />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
