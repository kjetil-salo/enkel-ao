import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/unit/**/*.test.js'],
    exclude: ['tests/e2e_playwright/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'tests/e2e_playwright/**',
        'public/js/main.js', // Integrasjonstest via E2E
        '**/*.config.js'
      ]
    }
  },
  resolve: {
    alias: {
      '@': '/public/js'
    }
  }
});
