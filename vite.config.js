import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  publicDir: false,
  server: {
    host: '127.0.0.1',
    watch: {
      ignored: [
        '**/otvengine/**',
        '**/otvengine-raw/**',
        '**/sg_pj-main/**',
        '**/참고/**',
        '**/참고/**',
      ],
    },
  },
  preview: {
    host: '127.0.0.1',
  },
});
