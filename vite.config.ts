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
    terserOptions: { compress: { passes: 3 } },
    sourcemap: false,
    rollupOptions: {
      output: {
        // Keep entry + chunk filenames predictable so cache busting is by hash only. Chunks and assets drop the
        // name: their paths repeat in every chunk's preload list, and the manifest still maps each to its source.
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[hash].js',
        assetFileNames: 'assets/[hash][extname]',
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
              // file reader, writer and file link stay out: only organizer pages load them, the download on demand. So
              // does the Clerk sign-in client, which only the sign-in box uses, and the zoned event times and
              // players' requests, which only the event page and the Players tab show, setup's drafts, and what a
              // dropped player's return does, which only the Players tab asks.
              // The format picker too: it carries every past format's archetypes, for setup and settings alone.
              // And staff.ts, the words only the organizer's pages put to results, reports and an ending.
              // Stores, the tab-to-tab change word, TOM's save beat and the live data status stay out as well:
              // the shell uses none of them. Nor the next-step workflow and share.ts, which keeps the parts of a
              // polled event that did not change: only the organizer's and event pages use them. Nor a correction's
              // preview or the linked .tdf's read beat, which only the console's corrections and TOM sync use.
              // The rest of the folder stays, as splitting it costs more in total than it saves up front: each
              // export the shell loses renames the ones before it in every route's imports, so a cut that removes
              // as many exports as it adds is the one that stays cheap.
              name: 'tournament',
              priority: 1,
              test: /(?:src[\\/]components[\\/]|src[\\/]main\.tsx$|tournaments[\\/](Field|SettingControls|OptionsMenu|Modal|ConfirmAction)\.tsx$|shared[\\/]tournament[\\/](?!tdf\.|xml\.|eventTime\.|requests\.|returns\.|lifecycleWorkflow\.)|src[\\/]lib[\\/]tournament[\\/](?!admin|applications|clerk|exportTdf|setupDraft|staff\.|stores\.|changes\.|tomSaves\.|liveData\.|tomLink\.|share\.|corrections\.|fileTicks\.))/,
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
