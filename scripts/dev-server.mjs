/**
 * Boot — or reuse — the Vite dev server for the tools that drive the app with a browser
 * (scripts/screenshot.mjs, scripts/check-clipping.mjs).
 *
 * Both tools want the same three things and must not drift on any of them: use the server
 * that is already listening if there is one, otherwise start vite directly (no shell, no
 * .cmd wrapper, one process to kill), and wait for the vault API to actually answer rather
 * than sleeping a guess. `--port` keeps two runs from fighting over 5173.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const BOOT_TIMEOUT_MS = 90_000;

/**
 * The dependencies Vite must have pre-bundled before a browser is pointed at the app.
 *
 * Vite scans for dependencies on the *first* request, and when it finds new ones it
 * rebundles and pushes a reload — mid-navigation, if that is when the browser arrived. A
 * page caught in that window loads two copies of React and dies with
 * "Cannot read properties of null (reading 'useRef')", which looks exactly like an app bug
 * and is not one. It happens on any cold cache, and `npm run build` leaves one behind, so
 * every tool that drives a browser warms the optimizer first and waits for it to settle.
 */
const WARM_DEPS = ["react", "react-dom/client", "react-router-dom", "@tauri-apps/api/window"];
const WARM_TIMEOUT_MS = 60_000;

/** The project rows from a server already answering on `origin`, or null. */
export async function ping(origin) {
  try {
    const res = await fetch(`${origin}/project-api/projects`, { signal: AbortSignal.timeout(1500) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/**
 * @param {number} port
 * @param {{ root?: string, env?: Record<string, string> }} [options]
 *   `env` adds to the server's environment — `AGENTMON_DIRS` above all, so a tool can
 *   drive the app against a throwaway copy of the records instead of the live ones.
 */
export function startServer(port, { root = repoRoot, env = {} } = {}) {
  const child = spawn(
    process.execPath,
    [join(root, "node_modules", "vite", "bin", "vite.js"), "--port", String(port), "--strictPort"],
    {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "0", ...env },
    },
  );
  child.stdout.on("data", (d) => process.env.DEBUG_SERVER && process.stdout.write(`  vite| ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`  vite| ${d}`));
  return child;
}

export async function waitForServer(child, origin, timeoutMs = BOOT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) {
      throw new Error(`dev server exited early with code ${child.exitCode}`);
    }
    const rows = await ping(origin);
    if (rows) {
      await warmOptimizer(origin);
      return rows;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`project API did not answer on ${origin} within ${timeoutMs / 1000}s`);
}

/**
 * Ask for the entry module (which starts Vite's dependency scan) and wait until the
 * optimizer has committed every dependency the app needs. Returns whether it settled;
 * callers carry on either way, because a slow warm-up is not a reason to refuse to run.
 */
export async function warmOptimizer(origin, root = repoRoot) {
  const get = async (path) => {
    try {
      await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(20_000) });
    } catch {
      /* the scan is what matters, not the body */
    }
  };
  await get("/");
  await get("/src/main.tsx");

  const meta = join(root, "node_modules", ".vite", "deps", "_metadata.json");
  const deadline = Date.now() + WARM_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const json = JSON.parse(readFileSync(meta, "utf8"));
      const have = Object.keys(json.optimized ?? {});
      if (WARM_DEPS.every((dep) => have.includes(dep))) {
        // The reload Vite pushes after committing lands before the browser opens.
        await new Promise((r) => setTimeout(r, 250));
        return true;
      }
    } catch {
      /* not written yet */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

/** Kill the dev server and wait for it to actually go, so exiting is not a race. */
export function stopServer(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    const done = setTimeout(resolve, 5_000);
    child.once("exit", () => {
      clearTimeout(done);
      resolve();
    });
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      child.kill("SIGTERM");
    }
  });
}

/**
 * Reuse the server on `origin` or start one on `port`.
 *
 * Returns `{ projects, server }`; `projects` is the row list the server answered with,
 * `server` is null when an existing one was reused, and the caller is responsible for
 * `stopServer(server)` when it is not. `requireRunning` is for `--url`: point at somebody
 * else's server and fail loudly if nothing is there.
 */
export async function ensureServer({ origin, port, requireRunning = false, log = () => {} }) {
  const running = await ping(origin);
  if (running) {
    log(`using the server already listening on ${origin}`);
    // Cheap when it has already settled, and the server may have been started a second ago.
    await warmOptimizer(origin);
    return { projects: running, server: null };
  }
  if (requireRunning) throw new Error(`nothing is serving ${origin}`);
  log("starting vite dev server…");
  const server = startServer(port);
  return { projects: await waitForServer(server, origin), server };
}
