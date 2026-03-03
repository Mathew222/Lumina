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
    // Proxy Google TTS requests to bypass COEP in Electron renderer
    proxy: {
      '/tts-proxy': {
        target: 'https://translate.google.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/tts-proxy/, '/translate_tts'),
        headers: {
          'Referer': 'https://translate.google.com/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      },
    },
  },
  // Ensure model files are served correctly
  publicDir: 'public',
  optimizeDeps: {
    exclude: ['vosk'],
  },
})

