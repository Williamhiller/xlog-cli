import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LEGACY_VIEWER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../viewer");
const REACT_VIEWER_DIST_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../viewer-react/dist"
);
const NODE_MODULES_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../node_modules");
const VIEWER_ASSET_CACHE = new Map();
const VENDOR_ROOTS = {
  remixicon: path.join(NODE_MODULES_ROOT, "remixicon", "fonts"),
  "framer-motion": path.join(NODE_MODULES_ROOT, "framer-motion", "dist"),
  "floating-ui": path.join(NODE_MODULES_ROOT, "@floating-ui", "dom", "dist"),
  "floating-ui-core": path.join(NODE_MODULES_ROOT, "@floating-ui", "core", "dist")
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function getViewerAssetPath(name) {
  return path.join(LEGACY_VIEWER_ROOT, name);
}

async function readViewerAsset(name) {
  if (!VIEWER_ASSET_CACHE.has(name)) {
    VIEWER_ASSET_CACHE.set(name, readFile(getViewerAssetPath(name), "utf8"));
  }

  return VIEWER_ASSET_CACHE.get(name);
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function hasBuiltReactViewer() {
  return fileExists(path.join(REACT_VIEWER_DIST_ROOT, "index.html"));
}

export async function getBuiltViewerAsset(assetPath = "index.html") {
  const safePath = path.normalize(assetPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const fullPath = path.resolve(REACT_VIEWER_DIST_ROOT, safePath);

  if (!fullPath.startsWith(REACT_VIEWER_DIST_ROOT)) {
    return null;
  }

  if (!(await fileExists(fullPath))) {
    return null;
  }

  return readFile(fullPath);
}

export async function buildViewerHtml({ title = "xlogger" } = {}) {
  const builtIndex = await getBuiltViewerAsset("index.html");
  if (builtIndex) {
    return builtIndex.toString("utf8").replaceAll("__XLOGGER_TITLE__", escapeHtml(title));
  }

  const template = await readViewerAsset("index.html");
  return template.replaceAll("__XLOGGER_TITLE__", escapeHtml(title));
}

export async function getViewerTextAsset(name) {
  return readViewerAsset(name);
}

export function getVendorAssetPath(vendor, assetPath) {
  const root = VENDOR_ROOTS[vendor];
  if (!root) {
    return null;
  }

  const safePath = path.normalize(assetPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const fullPath = path.resolve(root, safePath);

  if (!fullPath.startsWith(root)) {
    return null;
  }

  return fullPath;
}

export async function getVendorAsset(vendor, assetPath) {
  const fullPath = getVendorAssetPath(vendor, assetPath);
  if (!fullPath) {
    return null;
  }

  return readFile(fullPath);
}
