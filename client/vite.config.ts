import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * The client is a pure SPA; the Node server in `server/` owns `/api`.
 *
 * In development Vite proxies `/api` through to that server so the browser only
 * ever talks to one origin and there is no CORS story to maintain. Point
 * `VITE_DEV_API_PROXY` somewhere else if the server is not on the default port.
 *
 * https://vite.dev/config/
 */
const apiProxyTarget = process.env.VITE_DEV_API_PROXY ?? 'http://127.0.0.1:8080'

export default defineConfig({
  // Relative base so the built index.html references its assets relatively and
  // the app works mounted at any path prefix — a reverse-proxy sub-path, or the
  // per-session prefix Home Assistant ingress generates. The server injects a
  // matching <base href> at serve time so deep links resolve too.
  base: './',
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
})
