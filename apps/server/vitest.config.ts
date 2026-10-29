import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

if (existsSync('../../.env')) process.loadEnvFile('../../.env');

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.unit.test.ts', 'test/**/*.test.ts'],
    setupFiles: ['./test/setup-env.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // Integration tests share one database; run files sequentially.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
