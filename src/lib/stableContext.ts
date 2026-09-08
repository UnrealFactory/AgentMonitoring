/// <reference types="vite/client" />
import { createContext, type Context } from "react";

/** Providers and consumers can be refreshed in separate Vite update batches. Keep the
 * context identity across those batches, including edits to this module itself.
 * Production still uses ordinary React contexts; no application data is stored here. */
const contexts: Map<string, Context<unknown>> = import.meta.hot?.data.contexts ?? new Map();
if (import.meta.hot) import.meta.hot.data.contexts = contexts;

export function stableContext<T>(name: string, initialValue: T): Context<T> {
  if (!import.meta.hot) return createContext(initialValue);
  const existing = contexts.get(name);
  if (existing) return existing as Context<T>;
  const context = createContext(initialValue);
  contexts.set(name, context as Context<unknown>);
  return context;
}
