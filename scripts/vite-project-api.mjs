// Vite plugin: serve the registered project folders over `/project-api/*` in browser mode.
//
// This is the second transport described in SPEC.md. It exists so the UI can be driven
// (and screenshotted) without building the desktop app — the JSON it returns is the
// same JSON the Tauri commands return.
import { resolve } from "node:path";
import {
  createProjectsReader,
  handleAppFeedback,
  handleProjectApi,
  handleProjectDelete,
  handleProjectWrite,
  matchAssetRoute,
  readProjectAsset,
  resolveDirs,
  DATA_DIR,
  ProjectError,
} from "./project-fs.mjs";

const PREFIX = "/project-api";
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
        reject(new ProjectError(413, `request body over ${MAX_BODY} bytes`));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!text.trim()) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch (err) {
        reject(new ProjectError(400, `invalid JSON body: ${err.message}`));
      }
    });
    req.on("error", (err) => reject(new ProjectError(400, err.message)));
  });
}

/**
 * Folders a POST added during this session, so a project created from the browser stays
 * on the served list for the window that created it — the session twin of the desktop
 * registry. Keyed by nothing: the dev server serves one human.
 */
const sessionDirs = [];

/**
 * Folders a DELETE removed during this session. The desktop app unregisters a deleted
 * project; the browser's "registry" is `AGENTMON_DIRS`, which the server cannot edit —
 * so the removal is remembered here, and a deleted project leaves the served list the
 * same way it leaves the app's.
 */
const sessionRemoved = new Set();

/** One comparable spelling per path — Windows compares case-insensitively. */
const pathKey = (p) => (process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p));

function middleware(repoRoot, logger) {
  return async (req, res, next) => {
    if (!req.url || !req.url.startsWith(PREFIX)) return next();
    const url = new URL(req.url, "http://localhost");
    try {
      // Machine-level app feedback: about the app itself, belonging to no project — so
      // it answers before any folder is resolved, and works with zero projects served.
      const fb = await handleAppFeedback(repoRoot, req.method ?? "GET", url.pathname, () => readBody(req));
      if (fb !== null) {
        send(res, 200, fb);
        return;
      }
      // `?dirs=` points the dev server at other project folders for the session — the
      // browser-mode twin of the desktop app's registry (src/lib/api.ts carries it). A
      // configured folder that cannot be opened is an unavailable row; it is never
      // silently replaced with a different folder (see resolveDirs).
      const resolved = resolveDirs(repoRoot, url.searchParams.get("dirs"));
      const source = resolved.source;
      const dirs = resolved.dirs;
      for (const extra of sessionDirs) {
        if (!dirs.includes(extra)) dirs.push(extra);
      }
      const served = dirs.filter(
        (d) => !sessionRemoved.has(pathKey(d)) && !sessionRemoved.has(pathKey(`${d}/${DATA_DIR}`))
      );
      const reader = createProjectsReader(served, source);
      if (req.method === "POST") {
        const body = await readBody(req);
        const before = new Set(reader.dirs);
        const payload = handleProjectWrite(reader, repoRoot, url.pathname, body);
        for (const dir of reader.dirs) {
          if (!before.has(dir) && !sessionDirs.includes(dir)) sessionDirs.push(dir);
        }
        send(res, 200, payload);
        return;
      }
      // The one destructive route, and the only thing that reaches it is the app's own
      // confirm dialog: there is no CLI verb and no MCP tool for deleting a project, by
      // design (scripts/project-fs.mjs, src-tauri/src/lib.rs).
      if (req.method === "DELETE") {
        const payload = handleProjectDelete(reader, url.pathname, url.searchParams);
        // The desktop app unregisters what it deleted; this is the session's version.
        sessionRemoved.add(pathKey(payload.path));
        send(res, 200, payload);
        return;
      }
      if (req.method && req.method !== "GET" && req.method !== "HEAD") {
        throw new ProjectError(405, `${req.method} is not a project-api method`);
      }
      // Images a record body references — the one route that answers bytes, not JSON
      // (the browser twin of the desktop's `get_record_asset` command).
      const asset = matchAssetRoute(url.pathname);
      if (asset) {
        const { mime, bytes } = readProjectAsset(reader.byId(asset.id).root, asset.path);
        res.statusCode = 200;
        res.setHeader("content-type", mime);
        res.setHeader("cache-control", "no-store");
        res.end(bytes);
        return;
      }
      send(res, 200, handleProjectApi(reader, url.pathname, url.searchParams));
    } catch (err) {
      const status = err instanceof ProjectError ? err.status : 500;
      logger?.warn?.(`[project-api] ${status} ${url.pathname}: ${err.message}`);
      send(res, status, { error: err.message });
    }
  };
}

/**
 * @param {{ root?: string }} [options] repo root whose ./AgentMonitoring is the default
 */
export function projectApiPlugin(options = {}) {
  const repoRoot = options.root ?? process.cwd();
  return {
    name: "agentmon-project-api",
    configureServer(server) {
      server.middlewares.use(middleware(repoRoot, server.config.logger));

      /* No full-reload on a record write.
         Editing the records used to push `{type:"full-reload"}` down the HMR socket, which
         answered an agent's `agentmon work update` by throwing the reader's page away:
         scroll position gone, open day groups closed, a white flash mid-sentence. The app
         polls `/project-api/cursor` and re-runs its loaders in place (src/lib/api.ts,
         src/AppContext.tsx), so a write lands as new numbers, not as a new page.
         The served folders are also excluded from Vite's own watcher below, so a record
         write cannot trip module-graph invalidation either. */
      try {
        const { dirs } = resolveDirs(repoRoot);
        for (const dir of dirs) server.watcher.unwatch(dir);
      } catch (err) {
        server.config.logger.warn(`[project-api] ${err.message}`);
      }
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware(repoRoot, server.config.logger));
    },
  };
}
