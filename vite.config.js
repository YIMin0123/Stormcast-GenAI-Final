import { defineConfig } from 'vite';

export default defineConfig({
  base: './',   // 用相對路徑：放在 GitHub Pages 的子目錄（/Stormcast/）或自己的網域都能跑
  server: {
    port: 5173,
    strictPort: true,
    watch: { ignored: ['**/參考專案/**', '**/舊版備份_海嘯模擬器/**'] },
  },
  optimizeDeps: { entries: ['index.html'] },
});
