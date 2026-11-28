import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        input: {
          main: path.resolve(import.meta.dirname, 'index.html'),
          login: path.resolve(import.meta.dirname, 'login.html'),
          signup: path.resolve(import.meta.dirname, 'signup.html'),
          verify: path.resolve(import.meta.dirname, 'verify.html'),
          welcome: path.resolve(import.meta.dirname, 'welcome.html'),
          forgotPassword: path.resolve(import.meta.dirname, 'forgot-password.html'),
          resetPassword: path.resolve(import.meta.dirname, 'reset-password.html'),
          app: path.resolve(import.meta.dirname, 'app.html'),
        },
      },
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
      allowedHosts: true as const,
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
