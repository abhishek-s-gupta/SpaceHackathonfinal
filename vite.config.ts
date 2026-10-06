import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const localApi = {
  name: 'aegis-local-api',
  async configureServer(server: import('vite').ViteDevServer) {
    const { default: app } = await import('./server/app.ts');
    server.middlewares.use(app as any);
    console.log('Aegis API mounted inside Vite; no separate API port or proxy is needed.');
  },
};

export default defineConfig({
  plugins: [react(), localApi],
  server: { host: '127.0.0.1', port: 4040, strictPort: true },
});
