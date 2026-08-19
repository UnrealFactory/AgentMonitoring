import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

// Inter for the Latin, Pretendard Variable for the Hangul — both bundled with the app, no
// network at runtime (SPEC: no CDNs). Pretendard's dynamic subset is one @font-face per
// unicode-range, so a window fetches only the syllables it actually paints.
import "@fontsource-variable/inter";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";

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
