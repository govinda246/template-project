import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    allowedHosts: ['devcontainer', 'localhost', '127.0.0.1', '[::1]'],
  },
});
