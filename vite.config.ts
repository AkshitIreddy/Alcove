import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

const shim = (name: string): string =>
  fileURLToPath(new URL(`./scripts/shims/${name}`, import.meta.url));

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [solid()],

  resolve: {
    alias: {
      /**
       * Pixi pulls in a whole XML DOM implementation for one method on the
       * adapter it uses when Pixi runs inside a Web Worker — 57.2kB minified,
       * measured, in the chunk the SHELF boots from, for a call this app
       * cannot reach. The shim forwards to the platform's native DOMParser,
       * which every environment this app runs in has. See the shim's own
       * docblock for why it forwards rather than throws.
       */
      "@xmldom/xmldom": shim("xmldom-browser.mjs"),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
