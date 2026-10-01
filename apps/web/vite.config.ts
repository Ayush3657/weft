import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

const server = process.env.WEFT_SERVER ?? 'http://127.0.0.1:8787'
const here = path.dirname(fileURLToPath(import.meta.url))

/** Workspace packages live outside this app's root, so tell the dev server to watch them too. */
function watchWorkspacePackages(): Plugin {
  const dirs = [path.resolve(here, '../../packages/model/src')]
  return {
    name: 'weft:watch-workspace-packages',
    configureServer(dev) {
      dev.watcher.add(dirs)
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), watchWorkspacePackages()],
  resolve: {
    // One copy of Yjs, or its type checks (instanceof) break across packages.
    dedupe: ['yjs', 'react', 'react-dom'],
  },
  server: {
    port: 5173,
    strictPort: true,
    // Native file events on Windows sometimes miss quick successive writes,
    // leaving the browser on stale code; polling the small source tree is reliable.
    watch: process.platform === 'win32' ? { usePolling: true, interval: 250 } : undefined,
    // Prepare the app's code when the dev server starts, not on the first visit to each part.
    warmup: { clientFiles: ['./src/main.tsx', './src/write/Write.tsx', './src/write/Moodboard.tsx', './src/play/Play.tsx'] },
    proxy: {
      '/api': { target: server },
      '/sync': { target: server.replace(/^http/, 'ws'), ws: true },
    },
  },
})
