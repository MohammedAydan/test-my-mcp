import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import solidPlugin from 'vite-plugin-solid';
import { resolve } from 'path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@motionforge/core-engine', '@motionforge/scene-spec'] })],
    build: {
      rollupOptions: {
        external: ['playwright', 'playwright-core', 'fsevents'],
        input: {
          index: resolve(__dirname, 'src/main.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@motionforge/core-engine', '@motionforge/scene-spec'] })],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload.ts'),
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, '../studio'),
    css: {
      postcss: resolve(__dirname, '../studio/postcss.config.js'),
    },
    plugins: [solidPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, '../studio/index.html'),
        },
      },
    },
  },
});
