import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**", "**/crates/**", "**/sidecar/**"] },
  },
  build: {
    target: ["es2022", "chrome110", "safari15"],
    minify: "esbuild",
    sourcemap: false,
    chunkSizeWarningLimit: 700,
  },
});
