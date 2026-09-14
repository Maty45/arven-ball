import { defineConfig } from 'vite';

// El cliente vive en client/; el build sale a dist/ (que sirve el server).
export default defineConfig({
  root: 'client',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    // En dev, proxear el WebSocket del juego al server Node (npm run server).
    proxy: {
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
});
