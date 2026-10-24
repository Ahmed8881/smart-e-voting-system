/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // The browser only ever talks to the backend; same-origin in dev via this proxy.
    // xfwd passes the real client IP on, which the fraud rules use.
    proxy: {
      '/api': { target: process.env.VITE_BACKEND_URL ?? 'http://localhost:4000', xfwd: true },
    },
    // For phone testing through an HTTPS tunnel (docs/mobile-testing.md), e.g. abc.trycloudflare.com
    allowedHosts: process.env.VITE_ALLOWED_HOSTS?.split(',') ?? [],
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
})
