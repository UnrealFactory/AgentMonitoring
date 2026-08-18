// Vite plugin: serve the vault over `/vault-api/*` in browser mode.
//
// This is the second transport described in SPEC.md. It exists so the UI can be driven
// (and screenshotted) without building the desktop app — the JSON it returns is the
// same JSON the Tauri commands return.
import { createVaultReader, handleVaultApi, resolveVaultDir, VaultError } from "./vault-fs.mjs";

const PREFIX = "/vault-api";

function send(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(body);
}

function middleware(repoRoot, logger) {
  return (req, res, next) => {
    if (!req.url || !req.url.startsWith(PREFIX)) return next();
    const url = new URL(req.url, "http://localhost");
    try {
      const dir = resolveVaultDir(repoRoot);
      const reader = createVaultReader(dir);
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

      // Editing the vault (an agent running the CLI) reloads the page, so browser mode
      // behaves like the desktop app's filesystem watcher.
      try {
        const dir = resolveVaultDir(repoRoot);
        server.watcher.add(dir);
        server.watcher.on("all", (_event, file) => {
          if (String(file).replace(/\\/g, "/").includes("/vault/")) {
            server.ws.send({ type: "full-reload", path: "*" });
          }
        });
      } catch (err) {
        server.config.logger.warn(`[vault-api] ${err.message}`);
      }
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware(repoRoot, server.config.logger));
    },
  };
}
