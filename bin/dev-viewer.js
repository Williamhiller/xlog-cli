#!/usr/bin/env node

import path from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_BACKEND_HOST = "127.0.0.1";
const DEFAULT_BACKEND_PORT = 2718;
const DEFAULT_VIEWER_HOST = "127.0.0.1";
const DEFAULT_VIEWER_PORT = 5173;
const VITE_BIN = path.resolve(ROOT_DIR, "node_modules/vite/bin/vite.js");
const DEFAULT_BROWSER_CANDIDATES = [
  "Google Chrome",
  "Arc",
  "Brave Browser",
  "Microsoft Edge",
  "Safari"
];

function readPort(name, fallback) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const port = Number(raw);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Invalid ${name}: ${raw}`);
  }

  return port;
}

function readBoolean(name, fallback) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function pipeStream(stream, target, onLine) {
  if (!stream) {
    return;
  }

  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    target.write(chunk);
    if (!onLine) {
      return;
    }

    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      onLine(line);
    }
  });

  stream.on("end", () => {
    if (onLine && buffer) {
      onLine(buffer);
    }
  });
}

function waitForExit(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }

    child.once("exit", resolve);
  });
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill("SIGINT");
  await Promise.race([
    waitForExit(child),
    new Promise((resolve) => setTimeout(resolve, 1500))
  ]);

  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill("SIGTERM");
  await Promise.race([
    waitForExit(child),
    new Promise((resolve) => setTimeout(resolve, 1500))
  ]);

  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await waitForExit(child);
  }
}

function spawnProcess(command, args, env = {}, stdio = ["inherit", "pipe", "pipe"]) {
  return spawn(command, args, {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      ...env
    },
    stdio
  });
}

function spawnNodeProcess(args, env = {}) {
  return spawnProcess(process.execPath, args, env);
}

function runCommand(command, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(command, args, env, ["ignore", "pipe", "pipe"]);
    let stdout = "";
    let stderr = "";

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim()
        });
        return;
      }

      const detail = signal ? `signal ${signal}` : `code ${code}`;
      const error = new Error(stderr.trim() || `${command} exited with ${detail}`);
      error.stdout = stdout.trim();
      error.stderr = stderr.trim();
      reject(error);
    });
  });
}

function waitForBackendReady(child) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (error, value) => {
      if (settled) {
        return;
      }

      settled = true;
      child.off("exit", handleExit);

      if (error) {
        reject(error);
        return;
      }

      resolve(value);
    };

    const handleExit = (code, signal) => {
      const status = signal ? `signal ${signal}` : `code ${code}`;
      finish(new Error(`xlogger backend exited before becoming ready (${status})`));
    };

    pipeStream(child.stdout, process.stdout, (line) => {
      const match = line.match(/\[xlogger\] listening on (http:\/\/\S+)/);
      if (match) {
        finish(null, { serverUrl: match[1] });
      }
    });
    pipeStream(child.stderr, process.stderr);

    child.once("exit", handleExit);
  });
}

function attachExitHandler(child, label) {
  child.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }

    const status = signal ? `signal ${signal}` : `code ${code}`;
    console.error(`[xlogger] ${label} exited with ${status}`);
    shutdown(code === 0 ? 1 : code || 1);
  });
}

async function waitForUrl(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          accept: "text/html,application/json"
        }
      });

      if (response.ok) {
        return;
      }

      lastError = new Error(`Unexpected status ${response.status} for ${url}`);
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw lastError || new Error(`Timed out waiting for ${url}`);
}

function escapeAppleScriptString(value) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

async function openBrowserOnMac(url, browserHint = "") {
  const script = `
on run argv
  set targetUrl to item 1 of argv
  set alternateUrl to item 2 of argv
  set browserHint to item 3 of argv
  set browserCandidates to {}

  if browserHint is not "" then
    set end of browserCandidates to browserHint
  end if

  repeat with browserName in {${DEFAULT_BROWSER_CANDIDATES.map((name) => `"${escapeAppleScriptString(name)}"`).join(", ")}}
    set browserNameText to browserName as text
    if browserCandidates does not contain browserNameText then
      set end of browserCandidates to browserNameText
    end if
  end repeat

  repeat with browserName in browserCandidates
    set browserNameText to browserName as text
    if my app_path_exists(browserNameText) then
      if browserNameText is "Safari" then
        return my open_in_safari(targetUrl, alternateUrl)
      else
        return my open_in_chromium(browserNameText, targetUrl, alternateUrl)
      end if
    end if
  end repeat

  do shell script "open " & quoted form of targetUrl
  return "opened:SystemDefault"
end run

on app_path_exists(appName)
  try
    path to application appName
    return true
  on error
    return false
  end try
end app_path_exists

on url_matches(tabUrl, expectedUrl, alternateUrl)
  if tabUrl is missing value then
    return false
  end if

  if tabUrl is expectedUrl or tabUrl starts with expectedUrl then
    return true
  end if

  if alternateUrl is not "" and (tabUrl is alternateUrl or tabUrl starts with alternateUrl) then
    return true
  end if

  return false
end url_matches

on open_in_chromium(appName, targetUrl, alternateUrl)
  using terms from application "Google Chrome"
    tell application appName
      activate

      repeat with currentWindow in windows
        repeat with tabIndex from 1 to (count of tabs of currentWindow)
          set currentTab to tab tabIndex of currentWindow
          if my url_matches(URL of currentTab, targetUrl, alternateUrl) then
            set active tab index of currentWindow to tabIndex
            set index of currentWindow to 1
            reload active tab of currentWindow
            return "reused:" & appName
          end if
        end repeat
      end repeat
    end tell
  end using terms from

  do shell script "open -a " & quoted form of appName & " " & quoted form of targetUrl

  return "opened:" & appName
end open_in_chromium

on open_in_safari(targetUrl, alternateUrl)
  using terms from application "Safari"
    tell application "Safari"
      activate

      repeat with currentWindow in windows
        repeat with currentTab in tabs of currentWindow
          if my url_matches(URL of currentTab, targetUrl, alternateUrl) then
            set current tab of currentWindow to currentTab
            set index of currentWindow to 1
            set URL of currentTab to targetUrl
            return "reused:Safari"
          end if
        end repeat
      end repeat
    end tell
  end using terms from

  do shell script "open -a Safari " & quoted form of targetUrl

  return "opened:Safari"
end open_in_safari
`;

  const alternateUrl = url.endsWith("/") ? url.slice(0, -1) : `${url}/`;
  const result = await runCommand("osascript", ["-e", script, url, alternateUrl, browserHint]);
  return result.stdout || "opened:SystemDefault";
}

async function openBrowserFallback(url) {
  if (process.platform === "win32") {
    await runCommand("cmd", ["/c", "start", "", url]);
    return "opened:SystemDefault";
  }

  const command = process.platform === "darwin" ? "open" : "xdg-open";
  await runCommand(command, [url]);
  return "opened:SystemDefault";
}

async function openViewerInBrowser(url) {
  if (!readBoolean("XLOGGER_AUTO_OPEN", true)) {
    return "disabled";
  }

  const browserHint = process.env.XLOGGER_BROWSER_APP || "";

  if (process.platform === "darwin") {
    return openBrowserOnMac(url, browserHint);
  }

  return openBrowserFallback(url);
}

let backendChild = null;
let viteChild = null;
let shuttingDown = false;

async function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  await Promise.all([stopChild(viteChild), stopChild(backendChild)]);

  process.exit(exitCode);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    shutdown(0);
  });
}

async function main() {
  const backendHost = process.env.XLOGGER_BACKEND_HOST || DEFAULT_BACKEND_HOST;
  const backendPort = readPort("XLOGGER_BACKEND_PORT", DEFAULT_BACKEND_PORT);
  const viewerHost = process.env.XLOGGER_VIEWER_HOST || DEFAULT_VIEWER_HOST;
  const viewerPort = readPort("XLOGGER_VIEWER_PORT", DEFAULT_VIEWER_PORT);
  const backendUrl = `http://${backendHost}:${backendPort}`;
  const frontendUrl = `http://${viewerHost}:${viewerPort}/viewer/`;

  backendChild = spawnNodeProcess([
    path.resolve(ROOT_DIR, "bin/xlogger.js"),
    "serve",
    "--host",
    backendHost,
    "--port",
    String(backendPort),
    "--strict-port"
  ]);
  attachExitHandler(backendChild, "backend");
  await waitForBackendReady(backendChild);

  viteChild = spawnNodeProcess(
    [
      VITE_BIN,
      "--config",
      path.resolve(ROOT_DIR, "viewer-react/vite.config.js"),
      "--host",
      viewerHost,
      "--port",
      String(viewerPort),
      "--strictPort"
    ],
    {
      XLOGGER_VIEWER_BACKEND_URL: backendUrl,
      XLOGGER_VIEWER_HOST: viewerHost,
      XLOGGER_VIEWER_PORT: String(viewerPort)
    }
  );
  pipeStream(viteChild.stdout, process.stdout);
  pipeStream(viteChild.stderr, process.stderr);
  attachExitHandler(viteChild, "viewer");

  await waitForUrl(frontendUrl);

  try {
    const browserAction = await openViewerInBrowser(frontendUrl);
    if (browserAction !== "disabled") {
      console.log(`[xlogger] browser ${browserAction} ${frontendUrl}`);
    }
  } catch (error) {
    console.warn(`[xlogger] browser open skipped: ${error.message}`);
  }

  console.log(
    `[xlogger] viewer dev ready | frontend ${frontendUrl} | api ${backendUrl}`
  );
}

main().catch((error) => {
  console.error("[xlogger] failed to start viewer dev mode", error);
  shutdown(1);
});
