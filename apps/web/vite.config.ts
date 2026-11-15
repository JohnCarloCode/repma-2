import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Dev only: the web calls the same-origin `/api/v1` it gets in prod (2.11),
  // so the session cookie stays first-party (RNF-11).
  server: { proxy: { '/api': 'http://localhost:3000' } },
})
