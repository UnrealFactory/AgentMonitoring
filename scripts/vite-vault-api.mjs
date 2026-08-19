// Vite plugin: serve the vault over `/vault-api/*` in browser mode.
//
// This is the second transport described in SPEC.md. It exists so the UI can be driven
// (and screenshotted) without building the desktop app — the JSON it returns is the
// same JSON the Tauri commands return.
import {
  createVaultReader,
  handleVaultApi,
  handleVaultWrite,
  resolveVaultDir,
  VaultError,
} from "./vault-fs.mjs";

const PREFIX = "/vault-api";
/** A write body big enough for a project, small enough that nothing can wedge the server. */
const MAX_BODY = 64 * 1024;

function send(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let text = "";
    req.on("data", (chunk) => {
      text += chunk;
      if (text.length > MAX_BODY) {
        reject(new VaultError(413, `request body over ${MAX_BODY} bytes`));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!text.trim()) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch (err) {
        reject(new VaultError(400, `invalid JSON body: ${err.message}`));
      }
    });
    req.on("error", (err) => reject(new VaultError(400, err.message)));
  });
}

function middleware(repoRoot, logger) {
  return async (req, res, next) => {
    if (!req.url || !req.url.startsWith(PREFIX)) return next();
    const url = new URL(req.url, "http://localhost");
    try {
      // `?vault=` points the dev server at another vault for the session — the browser-mode
      // twin of the desktop app's "Open vault folder…" (src/lib/api.ts carries it).
      const dir = resolveVaultDir(repoRoot, url.searchParams.get("vault"));
      const reader = createVaultReader(dir);
      if (req.method === "POST") {
        const body = await readBody(req);
        send(res, 200, handleVaultWrite(reader, repoRoot, url.pathname, body));
        return;
      }
      if (req.method && req.method !== "GET" && req.method !== "HEAD") {
        throw new VaultError(405, `${req.method} is not a vault-api method`);
      }
      send(res, 200, handleVaultApi(reader, url.pathname, url.searchParams));
    } catch (err) {
      const status = err instanceof VaultError ? err.status : 500;
      logger?.warn?.(`[vault-api] ${status} ${url.pathname}: ${err.message}`);
      send(res, status, { error: err.message });
    }
  };
}

/**
 * @param {{ root?: string }} [options] repo root that contains ./vault
 */
export function vaultApiPlugin(options = {}) {
  const repoRoot = options.root ?? process.cwd();
  return {
    name: "agentmon-vault-api",
    configureServer(server) {
      server.middlewares.use(middleware(repoRoot, server.config.logger));

      /* No full-reload on a vault write.
         Editing the vault used to push `{type:"full-reload"}` down the HMR socket, which
         answered an agent's `agentmon work update` by throwing the reader's page away:
         scroll position gone, open day groups closed, a white flash mid-sentence. The app
         now polls `/vault-api/cursor` and re-runs its loaders in place (src/lib/api.ts,
         src/AppContext.tsx), so a write lands as new numbers, not as a new page.
         The vault is still excluded from Vite's own watcher below, so a record write cannot
         trip module-graph invalidation either. */
      try {
        const dir = resolveVaultDir(repoRoot);
        server.watcher.unwatch(dir);
      } catch (err) {
        server.config.logger.warn(`[vault-api] ${err.message}`);
      }
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware(repoRoot, server.config.logger));
    },
  };
}
