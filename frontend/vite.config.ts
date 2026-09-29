import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      // Прокси только для режима разработки. В переносимой сборке фронт
      // раздаёт сам backend из того же origin — прокси не нужен.
      // Порт по умолчанию совпадает с APP_PORT в settings.example.txt;
      // если меняете APP_PORT, задайте BACKEND_PORT здесь же.
      '/api': {
        target: `http://localhost:${process.env.BACKEND_PORT ?? '8080'}`,
        changeOrigin: true,
      },
    },
  },
});
