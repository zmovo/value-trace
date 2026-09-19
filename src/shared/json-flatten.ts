import { normalizeValue } from "./normalize";
import type { FlattenedEntry } from "./types";

const MAX_NODES = 50_000;

function pathSegment(key: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return `.${key}`;
  }
  return `['${key.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}']`;
}

/**
 * Recursively expand a JSON value into (jsonPath, scalar) pairs.
 *
 *   { data: { entryCount: 66860, list: [{ count: 100 }] } }
 *     → $.data.entryCount
 *     → $.data.list[0].count
 *
 * Only numeric / numeric-looking strings are kept. That is what the
 * value index can later look up from a hovered UI token.
 */
export function flattenJson(root: unknown): FlattenedEntry[] {
  const out: FlattenedEntry[] = [];
  let visited = 0;

  const walk = (value: unknown, path: string): void => {
    if (visited++ > MAX_NODES) {
      return;
    }
    if (value === null || value === undefined) {
      return;
    }

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        walk(value[i], `${path}[${i}]`);
        if (visited > MAX_NODES) {
          return;
        }
      }
      return;
    }

    if (typeof value === "object") {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        walk(child, `${path}${pathSegment(key)}`);
        if (visited > MAX_NODES) {
          return;
        }
      }
      return;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      out.push({
        jsonPath: path,
        rawValue: value,
        normalizedValues: normalizeValue(value),
      });
      return;
    }

    if (typeof value === "string") {
      const keys = normalizeValue(value);
      if (keys.length > 0) {
        out.push({ jsonPath: path, rawValue: value, normalizedValues: keys });
      }
    }
  };

  walk(root, "$");
  return out;
}
