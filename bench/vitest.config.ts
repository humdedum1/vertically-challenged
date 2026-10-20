import { defineConfig } from 'vitest/config';

// The pure-function benchmarks (bench/*.bench.ts), kept out of the normal test run.
export default defineConfig({
  test: {
    include: ['bench/**/*.bench.ts'],
    environment: 'node',
    silent: false,
    // One file, timed sequentially; nothing else should compete for the CPU.
    fileParallelism: false,
  },
});
