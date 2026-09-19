import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'child_process';
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

/**
 * What this build calls itself when asked which build it is.
 *
 * A published bundle is otherwise anonymous: `autoll3-release.json` records the
 * commit, but that file is on the site rather than in the app, so the phone in
 * a park cannot answer "is this the build we tested?" without a laptop. CI
 * supplies `GITHUB_SHA`; a local run asks git; anything else is a working copy
 * and says so.
 */
function buildRevision(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short=7 HEAD').toString().trim();
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  define: { __BUILD_REV__: JSON.stringify(buildRevision()) },
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
