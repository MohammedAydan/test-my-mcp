import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

const ENGINE = process.env.MOTIONFORGE_ENGINE ?? "http://localhost:4000";

export default defineConfig({
  plugins: [tailwindcss()],
  base: "./",
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: ENGINE, changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    target: "es2022",
    assetsInlineLimit: 0,
  },
});
