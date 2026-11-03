import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/noto-sans-sc";
import App from "./App";
import * as coach from "./coach";
import * as model from "./model";
import * as tour from "./tour-store";
import "./styles.css";

if (new URLSearchParams(window.location.search).has("shot")) {
  Object.assign(window, { __dev: { model, tour, coach } });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
