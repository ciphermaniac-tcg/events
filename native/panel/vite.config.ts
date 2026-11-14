/**
 * The desktop app's TOM panel: a page of its own, served to the Tauri "tom"
 * window from native/panel/dist, or from this dev server while developing.
 */

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

const repo = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [solid()],
  publicDir: false,
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    port: 4420,
    strictPort: true,
    // The panel reads the site's shared engine and fonts from the repository root.
    fs: { allow: [repo] }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022'
  }
});
