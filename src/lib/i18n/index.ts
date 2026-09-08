/** 한국어 전용 앱 문구입니다. 예전 URL·저장 설정의 언어 값은 사용하지 않습니다. */
import { ko, type Dict, type Key } from "./ko";

if (typeof document !== "undefined") document.documentElement.lang = "ko";

export type Args<K extends Key> = Dict[K] extends (...args: infer A) => string ? A : [];

export function t<K extends Key>(key: K, ...args: Args<K>): string {
  const value = ko[key];
  return typeof value === "function"
    ? (value as (...a: unknown[]) => string)(...(args as unknown[]))
    : value;
}

export type { Dict, Key };
export { ko };
