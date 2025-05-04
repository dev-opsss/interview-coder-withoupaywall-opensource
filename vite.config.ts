// vite.config.ts
import { defineConfig } from "vite"
import electron from "vite-plugin-electron"
import react from "@vitejs/plugin-react"
import path from "path"

// Simplified configuration focusing only on externalization of Electron core modules
export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        // main.ts
        entry: "electron/main.ts",
        vite: {
          build: {
            outDir: "dist-electron",
            sourcemap: true,
            minify: false,
            rollupOptions: {
              external: [
                'electron',
                'pdf-parse',
                'mammoth',
                '@google-cloud/speech',
                'node-vad',
                'screenshot-desktop',
                'electron-store',
                'electron-updater'
              ]
            }
          }
        }
      },
      {
        // preload.ts
        entry: "electron/preload.ts",
        vite: {
          build: {
            outDir: "dist-electron",
            sourcemap: true,
            minify: false,
            rollupOptions: {
              external: [
                'electron'
              ]
            }
          }
        }
      }
    ])
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    }
  }
})
