// vite.config.mjs
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const repo = process.env.GITHUB_REPOSITORY?.split('/')[1] || ''
export default defineConfig({
  plugins: [react()],
  base: repo ? `/${repo}/` : '/', // passt sich automatisch an, z.B. /Reisekosten2/
  build: {
    outDir: 'dist',
    sourcemap: false
  }
})
