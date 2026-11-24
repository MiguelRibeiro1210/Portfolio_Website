import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  publicDir: false,
  base: '/feed-assets/',
  build: {
    outDir: 'public/feed-assets',
    emptyOutDir: true,
    manifest: 'manifest.json',
    rolldownOptions: {
      input: fileURLToPath(new URL('./frontend/feed/mountFeed.jsx', import.meta.url)),
      preserveEntrySignatures: 'strict',
    },
  },
});
