import React from "react";
import ReactDOM from "react-dom/client";
import { App as AntdApp, ConfigProvider, theme as antdTheme } from "antd";
import "antd/dist/reset.css";
import "remixicon/fonts/remixicon.css";
import App from "./App.jsx";
import "./styles.css";

function getResolvedTheme(mode) {
  if (mode === "auto") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  return mode;
}

function Root() {
  const initialMode = document.documentElement.dataset.themeMode || "auto";
  const resolved = getResolvedTheme(initialMode);

  return (
    <ConfigProvider
      theme={{
        algorithm:
          resolved === "dark" ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: resolved === "dark" ? "#53d6a5" : "#0d9c73",
          borderRadius: 12,
          fontFamily:
            'ui-monospace, "SF Mono", "Cascadia Mono", "JetBrains Mono", "IBM Plex Mono", Consolas, monospace'
        }
      }}
    >
      <AntdApp>
        <App initialThemeMode={initialMode} />
      </AntdApp>
    </ConfigProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
