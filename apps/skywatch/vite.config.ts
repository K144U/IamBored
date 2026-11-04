import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the build works at any path (e.g. /IamBored/skywatch/ on GitHub Pages).
  base: './',
  worker: { format: 'es' },
  test: { environment: 'node' },
});
