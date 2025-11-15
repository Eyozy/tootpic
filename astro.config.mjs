import { defineConfig } from 'astro/config';
import tailwind from "@astrojs/tailwind";
import vercel from "@astrojs/vercel";

/**
 * Astro configuration with performance optimizations
 * https://astro.build/config
 */
export default defineConfig({
  integrations: [tailwind()],
  adapter: vercel(),

  output: 'server', // Server-side rendering (supports API routes)

  build: {
    inlineStylesheets: 'auto', // Auto-inline small CSS files (< 4KB)
    assets: '_astro',
  },

  vite: {
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'image-gen': ['@zumer/snapdom'], // Separate bundle for image generation
          }
        }
      }
    }
  },

  compressHTML: true,

  prefetch: {
    prefetchAll: false, // On-demand loading
    defaultStrategy: 'hover', // Prefetch on hover
  }
});
