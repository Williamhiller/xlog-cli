import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { viteSingleFile } from "vite-plugin-singlefile";
import { xlogViteClientPlugin } from "../src/plugins/vite-plugin.js";
import xlogBabelPlugin from "../src/plugins/babel-plugin.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_VIEWER_HOST = "127.0.0.1";
const DEFAULT_VIEWER_PORT = 5173;
const DEFAULT_BACKEND_URL = "http://127.0.0.1:2718";

function readPort(value, fallback) {
  const port = Number(value);
  return Number.isFinite(port) && port > 0 ? port : fallback;
}

const viewerHost = process.env.XLOG_VIEWER_HOST || DEFAULT_VIEWER_HOST;
const viewerPort = readPort(process.env.XLOG_VIEWER_PORT, DEFAULT_VIEWER_PORT);
const backendUrl = process.env.XLOG_VIEWER_BACKEND_URL || DEFAULT_BACKEND_URL;

export default defineConfig(({ command }) => ({
  base: "/viewer/",
  plugins: [
    xlogViteClientPlugin({
      serverUrl: backendUrl,
      projectName: "xlog-viewer",
      tool: "vite"
    }),
    react(
      command === "serve"
        ? {
            babel: {
              plugins: [xlogBabelPlugin]
            }
          }
        : {}
    ),
    command === "build" ? viteSingleFile() : null
  ].filter(Boolean),
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
