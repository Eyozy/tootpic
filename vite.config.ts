import { defineConfig } from 'vite';

/**
 * Vite performance optimization configuration
 * Features: code splitting, dependency pre-bundling, chunk size optimization
 */
export default defineConfig({
  build: {
    cssCodeSplit: true,
    chunkSizeWarningLimit: 500,

    rollupOptions: {
      output: {
        manualChunks: {
          // Separate heavy image generation library
          'image-gen': ['@zumer/snapdom'],

          // Separate fediverse client and parser (lazy loaded on preview)
          'fediverse': [
            './src/utils/fediverseClient',
            './src/utils/activitypubParser'
          ],

          // Separate UI utilities (template manager, DOM cache)
          'ui-utils': [
            './src/utils/templateManager',
            './src/utils/domCache'
          ]
        },

        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      }
    },

    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
        pure_funcs: ['console.log', 'console.info', 'console.debug']
      }
    },

    sourcemap: false
  },

  optimizeDeps: {
    include: [
      '@zumer/snapdom',
      'zod'
    ],
    exclude: []
  },

  server: {
    port: 4321,
    open: false
  }
});
