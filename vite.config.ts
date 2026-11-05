import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import wasm from "vite-plugin-wasm";

// zenoh-ts ships a WASM key-expression module, hence vite-plugin-wasm
// (the Nuxt example also uses it). Top-level await is left native, so the
// build targets esnext; vite-plugin-top-level-await crashes on this toolchain.
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss(), wasm()],
  build: { target: "esnext" },
  optimizeDeps: { esbuildOptions: { target: "esnext" } },
});
