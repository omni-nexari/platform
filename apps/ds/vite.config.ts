import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import legacy from '@vitejs/plugin-legacy';

const proxyConfig = {
  '/api': {
    target: 'http://localhost:3000',
    changeOrigin: true,
    ws: true,
    rewrite: (path: string) => path.replace(/^\/api(?!\/v1)/, '/api/v1'),
  },
};

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Generates a <script nomodule> legacy bundle for Tizen 4.0 (Chrome 56).
    // Tizen 4.0 ignores <script type="module"> and executes the nomodule fallback.
    legacy({
      targets: ['chrome >= 56', 'safari >= 10'],
    }),
  ],
  server: {
    host: true,
    port: 5173,
    proxy: proxyConfig,
  },
  // vite preview (port 5174) serves the production build for TV display URLs.
  // Use this instead of the dev server when the URL must work on Tizen 4.0.
  preview: {
    host: true,
    port: 5174,
    strictPort: true,
    proxy: proxyConfig,
  },
  build: {
    chunkSizeWarningLimit: 2500,
  },
});
