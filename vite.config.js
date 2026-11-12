import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    watch: { ignored: ['**/參考專案/**', '**/舊版備份_海嘯模擬器/**'] },
  },
  optimizeDeps: { entries: ['index.html'] },
});
