import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000'
    }
  },
  build: {
    target: 'es2019'
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.js']
  }
});
