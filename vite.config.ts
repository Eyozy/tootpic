import { defineConfig } from 'vite';

/**
 * Vite 性能优化配置
 * 老王优化：代码分割、依赖预构建、chunk 大小优化
 */
export default defineConfig({
  build: {
    // 启用 CSS 代码分割
    cssCodeSplit: true,

    // 设置合理的 chunk 大小警告阈值 (500 KB)
    chunkSizeWarningLimit: 500,

    rollupOptions: {
      output: {
        // 手动配置代码分割策略
        manualChunks: {
          // 将重量级的 snapdom 图片生成库单独打包
          'image-gen': ['@zumer/snapdom'],

          // 将超长的 fediverseClient 和相关工具单独打包
          // 这些只在用户点击"生成预览"时才需要加载
          'fediverse': [
            './src/utils/fediverseClient',
            './src/utils/activitypubParser'
          ],

          // UI 管理工具分离 (模板、DOM缓存)
          'ui-utils': [
            './src/utils/templateManager',
            './src/utils/domCache'
          ]
        },

        // 优化 chunk 文件命名
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      }
    },

    // 生产环境启用压缩
    minify: 'terser',
    terserOptions: {
      compress: {
        // 移除 console 和 debugger
        drop_console: true,
        drop_debugger: true,
        // 移除无用代码
        pure_funcs: ['console.log', 'console.info', 'console.debug']
      }
    },

    // 启用源码映射 (生产环境可选)
    sourcemap: false
  },

  // 优化依赖预构建
  optimizeDeps: {
    // 明确包含需要预构建的依赖
    include: [
      '@zumer/snapdom',
      'zod'
    ],

    // 排除不需要预构建的依赖
    exclude: []
  },

  // 服务器配置
  server: {
    // 启用 HTTP/2
    https: false,

    // 端口配置
    port: 4321,

    // 自动打开浏览器
    open: false
  }
});
