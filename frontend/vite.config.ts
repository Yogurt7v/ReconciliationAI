import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      // Проксируем API на локальный backend; порт можно переопределить
      // (на macOS порт 5000 часто занят AirPlay Receiver)
      '/api': {
        target: `http://localhost:${process.env.BACKEND_PORT ?? '5057'}`,
        changeOrigin: true,
      },
    },
  },
});
