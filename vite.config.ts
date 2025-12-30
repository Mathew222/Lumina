import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    strictPort: true,
    port: 5173,
    // Ensure proper CORS and headers for model files
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
  // Ensure model files are served correctly
  publicDir: 'public',
  optimizeDeps: {
    exclude: ['vosk'],
  },
})
