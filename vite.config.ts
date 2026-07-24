/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  worker: {
    format: 'es',
  },
  test: {
    // Playwright owns e2e/*.spec.ts; Vitest owns tests/*.test.ts.
    include: ['tests/**/*.test.ts'],
  },
});
