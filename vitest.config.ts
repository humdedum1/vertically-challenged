import { defineConfig } from 'vitest/config';

// Pure-logic tests only; no extension APIs or DOM, so no WXT plugin needed.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.{ts,mjs}'],
    environment: 'node',
  },
});
