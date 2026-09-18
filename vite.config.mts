import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

import { APP_NAME } from './src/appIdentity';

const server = {
  host: '0.0.0.0',
  port: 3000,
  https: {
    cert: './tls/dev.cert',
    key: './tls/dev.key',
  },
  headers: {
    'Access-Control-Allow-Origin': '*',
  },
};

export default defineConfig({
  // GitHub Pages serves the build from a path named for the repository, which
  // is also what the app calls itself -- the same segment `PAGES_BASE` builds
  // its URLs on. Reaching into browser-side code from a node-side config is
  // safe here only because `appIdentity` touches `document` inside a function
  // body rather than at module scope.
  base: `/${APP_NAME}/`,
  root: 'src',
  resolve: {
    alias: {
      '@/': path.join(__dirname, 'src') + '/',
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: false,
    rollupOptions: {
      input: ['src/bg1.tsx', 'src/bg1.css', 'src/responder.html'],
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name][extname]',
      },
    },
  },
  esbuild: {
    charset: 'ascii',
  },
  server,
  preview: server,
  plugins: [react(), tailwindcss()],
});
