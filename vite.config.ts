import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
const apiTarget = 'http://127.0.0.1:3847'

export default defineConfig({
  // Keeps Tauri `devUrl` (http://localhost:5173) aligned when the port is taken.
  clearScreen: false,
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: apiTarget, ws: true },
    },
  },
  preview: {
    host: true,
    port: 4173,
    proxy: {
      '/api': { target: apiTarget, ws: true },
    },
  },
})
