/**
 * Let a gate import the app's own modules, the way the app imports them.
 *
 *   import { register } from "node:module";
 *   register("./ts-hooks.mjs", import.meta.url);
 *   const { vaultErrorMessage } = await import("../src/lib/api.ts");
 *
 * Node 24 runs TypeScript by stripping the types, which is all a gate needs — but it
 * resolves specifiers by the ESM rules, and the app is written against Vite's: `./i18n` for
 * a directory with an `index.ts` in it, `./en` for `en.ts`. Twenty lines here is the price
 * of a gate testing the real `src/lib/api.ts` instead of a copy of it, and a copy is exactly
 * how the desktop app came to answer a stale link with the wrong sentence for a whole round.
 */
import { existsSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const CANDIDATES = [".ts", ".tsx", "/index.ts", "/index.tsx"];

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && context.parentURL) {
    const target = fileURLToPath(new URL(specifier, context.parentURL));
    const direct = existsSync(target) && statSync(target).isFile();
    if (!direct) {
      for (const ext of CANDIDATES) {
        if (existsSync(target + ext)) {
          return nextResolve(pathToFileURL(target + ext).href, context);
        }
      }
    }
  }
  return nextResolve(specifier, context);
}
