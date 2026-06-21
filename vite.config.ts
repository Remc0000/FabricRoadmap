import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react-swc';
import { resolve } from 'path';
import { defineConfig } from 'vite';

const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1];
const defaultBasePath =
  process.env.GITHUB_ACTIONS === 'true' && repositoryName
    ? `/${repositoryName}/`
    : '/';

export default defineConfig({
  base: process.env.VITE_BASE_PATH || defaultBasePath,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
    },
  },
  build: {
    target: 'es2022',
  },
  esbuild: {
    target: 'es2022',
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'es2022',
    },
  },
});
