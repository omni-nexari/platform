import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2017',
    rollupOptions: {
      input: 'index.html',
    },
  },
});
