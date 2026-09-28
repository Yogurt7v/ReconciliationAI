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
        // BACKEND_URL — для all-in-one образа (127.0.0.1 внутри контейнера);
        // BACKEND_PORT — локальная разработка; по умолчанию 5057.
        target: process.env.BACKEND_URL ?? `http://localhost:${process.env.BACKEND_PORT ?? '5057'}`,
        changeOrigin: true,
      },
    },
  },
});
