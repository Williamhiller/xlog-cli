import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { xloggerViteClientPlugin } from "../src/plugins/vite-plugin.js";
import xloggerBabelPlugin from "../src/plugins/babel-plugin.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_VIEWER_HOST = "127.0.0.1";
const DEFAULT_VIEWER_PORT = 5173;
const DEFAULT_BACKEND_URL = "http://127.0.0.1:2718";

function readPort(value, fallback) {
  const port = Number(value);
  return Number.isFinite(port) && port > 0 ? port : fallback;
}

const viewerHost = process.env.XLOGGER_VIEWER_HOST || DEFAULT_VIEWER_HOST;
const viewerPort = readPort(process.env.XLOGGER_VIEWER_PORT, DEFAULT_VIEWER_PORT);
const backendUrl = process.env.XLOGGER_VIEWER_BACKEND_URL || DEFAULT_BACKEND_URL;

export default defineConfig(({ command }) => ({
  base: "/viewer/",
  plugins: [
    xloggerViteClientPlugin({
      serverUrl: backendUrl,
      projectName: "xlogger-viewer",
      tool: "vite"
    }),
    react(
      command === "serve"
        ? {
            babel: {
              plugins: [xloggerBabelPlugin]
            }
          }
        : {}
    )
  ],
  root: __dirname,
  server: {
    host: viewerHost,
    port: viewerPort,
    strictPort: true,
    proxy: {
      "/api": {
        target: backendUrl,
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      input: path.resolve(__dirname, "index.html"),
      output: {
        inlineDynamicImports: true,
        entryFileNames: "viewer.js",
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.endsWith(".css")) {
            return "viewer.css";
          }

          return "assets/[name]-[hash][extname]";
        }
      }
    }
  }
}));
