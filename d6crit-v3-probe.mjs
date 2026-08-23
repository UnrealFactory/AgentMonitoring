import { chromium } from "playwright";
const b = await chromium.connectOverCDP("http://localhost:9223");
const ctxs = b.contexts();
console.log("contexts", ctxs.length, "pages", ctxs.map(c=>c.pages().length));
const p = ctxs[0].pages()[0];
console.log("url", p.url());
const info = await p.evaluate(async () => ({
  ua: navigator.userAgent.slice(-70),
  tauri: typeof window.__TAURI_INTERNALS__,
  visible: await window.__TAURI_INTERNALS__?.invoke("plugin:window|is_visible").catch(e=>"ERR"+e),
  inner: [innerWidth, innerHeight],
  dpr: devicePixelRatio,
  lang: document.documentElement.lang,
  title: document.title,
  session: sessionStorage.getItem("agentmon.recordView"),
  localeLS: localStorage.getItem("agentmon.locale"),
}));
console.log(JSON.stringify(info,null,1));
await b.close();
