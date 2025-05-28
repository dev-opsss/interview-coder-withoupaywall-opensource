// vite.config.ts
import { defineConfig } from "vite"
import electron from "vite-plugin-electron"
import react from "@vitejs/plugin-react"
import path from "path"
import renderer from 'vite-plugin-electron-renderer'

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
                '@grpc/grpc-js',
                '@grpc/proto-loader',
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
        },
        onstart(options) {
          options.startup()
        }
      }
    ]),
    renderer()
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    }
  },
  // Define global variables to simulate Node.js environment in the browser
  define: {
    'process.env': {},
    'global': 'globalThis',
    'process.browser': true,
    'Buffer': ['buffer', 'Buffer']
  },
  // Configure Vite to handle Node.js built-ins
  build: {
    rollupOptions: {
      external: [
        // External modules that should not be bundled
        '@google-cloud/speech',
        '@grpc/grpc-js',
        '@grpc/proto-loader',
        'electron'
      ],
    }
  },
  // Provide proper electron renderer settings
  optimizeDeps: {
    exclude: ['electron', '@google-cloud/speech', '@grpc/grpc-js', '@grpc/proto-loader']
  }
})
