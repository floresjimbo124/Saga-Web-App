import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // The embedded Roboto PDF fonts (~1.4 MB) are only downloaded when a PDF is generated,
    // so they never affect page load. Everything else is well under this limit.
    chunkSizeWarningLimit: 1500,
  },
})
