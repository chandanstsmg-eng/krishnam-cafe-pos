import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // The service worker reads this to keep every screen available offline.
    manifest: 'asset-manifest.json',
    chunkSizeWarningLimit: 900,
    target: 'es2022',
  },
  server: { fs: { allow: ['.'] } },
});
