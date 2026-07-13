import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/@xyflow')) return 'workflow-canvas'
          if (id.includes('node_modules/react')) return 'react-vendor'
          if (id.includes('node_modules/marked')) return 'markdown'
        },
      },
    },
  },
  server: { proxy: { '/api': 'http://localhost:1717' } },
})
