import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: '.',
    emptyOutDir: false,
    target: 'es2017',
    rollupOptions: {
      input: 'index.html',
    },
  },
});
