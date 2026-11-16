import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.ts'],
    // jsdom + user-event flows with many steps can pass 5s when every workspace's suite runs at once (`npm run check`).
    testTimeout: 15_000,
  },
});
