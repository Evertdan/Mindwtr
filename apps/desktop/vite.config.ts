/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(__dirname, "./src") },
      {
        find: /^@mindwtr\/core$/,
        replacement: path.resolve(__dirname, "../../packages/core/src/index.ts"),
      },
      {
        find: /^@mindwtr\/core\/(.+)$/,
        replacement: path.resolve(__dirname, "../../packages/core/src/$1.ts"),
      },
    ],
  },
  // Prevenir que vite oculte errores de rust en la consola
  clearScreen: false,
  // Tauri espera un puerto fijo
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
    fs: {
      allow: [
        path.resolve(__dirname, '..', '..'),
        ...(fs.existsSync(path.resolve(__dirname, '../../../Mindwtr'))
          ? [path.resolve(__dirname, '../../../Mindwtr')]
          : []),
      ],
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    css: true,
    setupFiles: './src/test/setup.ts',
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@radix-ui')) return 'radix-vendor';
            if (id.includes('lucide-react')) return 'icons-vendor';
            if (id.includes('@tauri-apps')) return 'tauri-vendor';
            return 'vendor';
          }
        },
      },
    },
  },
})
