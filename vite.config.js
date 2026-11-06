import { defineConfig } from 'vite';

// Relatieve paden, zodat de build werkt op https://ylemaalem.github.io/EigenKoers/
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2020',
    sourcemap: false,
  },
});
