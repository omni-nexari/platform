import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  root: 'src/renderer',
  base: './',
  resolve: {
    alias: {
      '@sync': path.resolve(__dirname, '../player-web/src/sync'),
    },
    // Allow .js imports to resolve to .ts source when using Vite
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs'],
  },
  optimizeDeps: {
    // hls.js and pdfjs-dist need to be pre-bundled
    include: ['hls.js', 'pdfjs-dist'],
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        player: path.resolve(__dirname, 'src/renderer/index.html'),
        pairing: path.resolve(__dirname, 'src/renderer/pairing.html'),
      },
    },
    // Increase chunk size warn limit for pdfjs-dist
    chunkSizeWarningLimit: 3000,
  },
});
