import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const backendTarget = process.env.VITE_API_PROXY_TARGET ?? 'https://polarisai.gleeze.com/'

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
