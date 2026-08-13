import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// PowerSync's web layer (used under the hood by @powersync/capacitor on the
// web fallback) needs a global Buffer polyfill — see the Web SDK README.
// optimizeDeps.exclude is required for the wa-sqlite wasm worker; without it
// Vite pre-bundles the worker incorrectly and sync silently fails to start.
export default defineConfig({
  plugins: [react()],
  define: {
    global: 'globalThis',
  },
  optimizeDeps: {
    exclude: ['@journeyapps/wa-sqlite', '@powersync/web'],
  },
  worker: {
    format: 'es',
  },
});
