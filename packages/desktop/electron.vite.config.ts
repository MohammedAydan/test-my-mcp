import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import solidPlugin from 'vite-plugin-solid';
import type { PluginOption } from 'vite';
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
    // `vite-plugin-solid` is resolved against the workspace-root Vite while
    // electron-vite uses the package-local Vite, so the two `Plugin` types are
    // structurally identical but nominally different. The cast keeps the
    // config typechecked without duplicating the dependency.
    plugins: [solidPlugin() as unknown as PluginOption],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, '../studio/index.html'),
        },
      },
    },
  },
});
