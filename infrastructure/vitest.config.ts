import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The first test in each file synthesizes all stacks (several seconds).
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
