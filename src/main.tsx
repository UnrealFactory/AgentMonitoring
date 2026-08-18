import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

// Inter, bundled with the app — no network at runtime (SPEC: no CDNs).
import "@fontsource-variable/inter";

import "./styles/tokens.css";
import "./styles/app.css";

import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
