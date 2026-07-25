import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backendTarget = process.env.VITE_API_PROXY_TARGET ?? 'https://polarisai-mono.onrender.com'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/auth': { target: backendTarget, changeOrigin: true },
      '/code': { target: backendTarget, changeOrigin: true },
      '/ingest': { target: backendTarget, changeOrigin: true },
      '/billing': { target: backendTarget, changeOrigin: true },
      '/events': { target: backendTarget, changeOrigin: true },
      '/list': { target: backendTarget, changeOrigin: true },
      '/plan': { target: backendTarget, changeOrigin: true },
      '/api': { target: backendTarget, changeOrigin: true },
    },
  },
})
