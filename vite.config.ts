import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

export default defineConfig({
  plugins: [wasm(), topLevelAwait()],

  worker: {
    format: "es",
    plugins: () => [wasm(), topLevelAwait()],
  },

  resolve: {
    alias: {
      "mc-core": "/crates/mc-core/pkg/mc_core.js",
    },
  },

  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },

  optimizeDeps: {
    exclude: ["mc-core"],
  },
});
