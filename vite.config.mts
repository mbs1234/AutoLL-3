import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

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
  base: '/AutoLL-3/',
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
