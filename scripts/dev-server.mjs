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
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const BOOT_TIMEOUT_MS = 90_000;

/** The vault info from a server already answering on `origin`, or null. */
export async function ping(origin) {
  try {
    const res = await fetch(`${origin}/vault-api/vault`, { signal: AbortSignal.timeout(1500) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export function startServer(port, { root = repoRoot } = {}) {
  const child = spawn(
    process.execPath,
    [join(root, "node_modules", "vite", "bin", "vite.js"), "--port", String(port), "--strictPort"],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, FORCE_COLOR: "0" } },
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
    const info = await ping(origin);
    if (info) return info;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`vault API did not answer on ${origin} within ${timeoutMs / 1000}s`);
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
 * Returns `{ vault, server }`; `server` is null when an existing one was reused, and the
 * caller is responsible for `stopServer(server)` when it is not. `requireRunning` is for
 * `--url`: point at somebody else's server and fail loudly if nothing is there.
 */
export async function ensureServer({ origin, port, requireRunning = false, log = () => {} }) {
  const running = await ping(origin);
  if (running) {
    log(`using the server already listening on ${origin}`);
    return { vault: running, server: null };
  }
  if (requireRunning) throw new Error(`nothing is serving ${origin}`);
  log("starting vite dev server…");
  const server = startServer(port);
  return { vault: await waitForServer(server, origin), server };
}
