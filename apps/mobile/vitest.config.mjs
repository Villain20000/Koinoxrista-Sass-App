import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The API client is pure Node-fetch logic; no React Native runtime here.
    environment: 'node',
    globals: true,
  },
});