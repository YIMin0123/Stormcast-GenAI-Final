import { defineConfig } from 'vite';

export default defineConfig({
  base: './',   // 用相對路徑：放在網域根目錄或任何子目錄都能跑
  server: {
    port: 5173,
    strictPort: true,
    watch: { ignored: ['**/參考專案/**', '**/舊版備份_海嘯模擬器/**'] },
  },
  optimizeDeps: { entries: ['index.html'] },
  build: { target: 'es2022' },   // 人物模型在模組最上層 await 載入
});
