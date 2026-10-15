import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { resolve } from 'node:path';

/**
 * Ciphermaniac frontend — Vite + Solid.
 *
 * Output goes to `dist/` so Cloudflare Pages can serve it (see wrangler.toml).
 * Static assets that should be served verbatim live in `static/` (Vite's publicDir).
 * The `functions/` directory is untouched — Pages picks it up alongside the static build.
 */
export default defineConfig({
  plugins: [solid()],
  publicDir: 'static',
  build: {
    outDir: 'dist',
    manifest: true,
    emptyOutDir: true,
    target: 'es2022',
    minify: 'terser',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Keep entry + chunk filenames predictable so cache busting is by hash only.
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        codeSplitting: {
          groups: [
            {
              name: 'core',
              priority: 2,
              test: /src[\\/]lib[\\/](format|concurrency)\.ts$/,
              includeDependenciesRecursively: false
            },
            {
              // Share the shell, controls and event helpers so route chunks do not repeat their wrappers. The TOM
              // file reader and writer stay out: only organizer pages load them, the download on demand. So
              // does the Clerk sign-in client, which only the sign-in box uses, and the zoned event times and
              // players' requests, which only the event page and the Players tab show, and setup's drafts.
              name: 'tournament',
              priority: 1,
              test: /(?:src[\\/]components[\\/]|src[\\/]main\.tsx$|tournaments[\\/](Field|FormatSelect|SettingControls|OptionsMenu|Modal|ConfirmAction)\.tsx$|shared[\\/]tournament[\\/](?!tdf\.|xml\.|eventTime\.|requests\.)|src[\\/]lib[\\/]tournament[\\/](?!admin|applications|clerk|exportTdf|setupDraft))/,
              includeDependenciesRecursively: true
            },
            // The Swiss engine runs in the browser only for the /host home page's sample event. Its own
            // chunk keeps it off every page that shares event helpers.
            {
              name: 'pairing',
              priority: 2,
              test: /shared[\\/]tournament[\\/](?:pairing|random)\.|src[\\/]lib[\\/]tournament[\\/]sampleEvent\./,
              includeDependenciesRecursively: false
            }
          ]
        }
      }
    }
  },
  resolve: {
    alias: {
      '~': resolve(import.meta.dirname, 'src')
    }
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      // Pages Functions live at /api/*. Vite does not run them, so this
      // proxies to a LOCAL Wrangler — run `npm run dev:functions` in a second
      // terminal. Deliberately local rather than production: a dev session
      // must not reach the live database.
      '/api': {
        target: 'http://localhost:8788',
        changeOrigin: true,
        secure: false
      }
    }
  }
});
