import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Each API test starts its own in-memory Postgres, which takes a moment.
    testTimeout: 20_000,
  },
});
