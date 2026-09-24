export function toDisplayUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

export function urlAffinity(apiUrl: string, pageUrl: string): number {
  try {
    const api = new URL(apiUrl);
    const page = new URL(pageUrl);
    let score = 0;
    if (api.origin === page.origin) {
      score += 4;
    }
    const apiParts = api.pathname.split("/").filter(Boolean);
    const pageParts = page.pathname.split("/").filter(Boolean);
    let i = 0;
    while (i < apiParts.length && i < pageParts.length && apiParts[i] === pageParts[i]) {
      i += 1;
    }
    return score + i;
  } catch {
    return 0;
  }
}

/** Last few path segments so Network search is specific enough. */
export function apiNameSuffix(url: string, segments = 3): string {
  try {
    const parsed = new URL(url);
    return joinTail(parsed.pathname.split("/").filter(Boolean), segments) || parsed.pathname;
  } catch {
    return joinTail(url.split("/").filter(Boolean), segments) || url;
  }
}

function joinTail(parts: string[], segments: number): string {
  return parts.slice(-Math.max(1, segments)).join("/");
}

/** Same endpoint despite query tokens used for polling / cache busting. */
export function canonicalRequestUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

/** $.data[0].count and $.data[12].count are the same field in a list. */
export function generalizeJsonPath(path: string): string {
  return path.replace(/\[\d+\]/g, "[*]");
}

const URL_NOISE = new Set(["api", "v1", "v2", "v3", "v4"]);

/** Drop `api` / `v1` noise so the card can show a service name and a short path. */
export function presentRequestUrl(displayUrl: string): { service: string; path: string } {
  const pathOnly = displayUrl.split("?")[0] ?? displayUrl;
  const kept = pathOnly.split("/").filter((part) => part && !URL_NOISE.has(part.toLowerCase()));
  if (kept.length === 0) {
    return { service: "", path: pathOnly || displayUrl };
  }
  if (kept.length === 1) {
    return { service: "", path: `/${kept[0]}` };
  }
  return { service: kept[0], path: `/${kept.slice(1).join("/")}` };
}

/** `$.data.records[0].absentDuration` → `data.records[0].absentDuration`. */
export function presentJsonPath(path: string): string {
  return path.replace(/^\$\.?/, "");
}

const WRAPPER_SEGMENTS = new Set(["value", "values", "data", "item", "items", "list", "result", "results"]);

/** A field name a colleague can read. `$.data[1].absentTime` becomes "Absent time". */
export function fieldLabel(path: string): string {
  const parts = generalizeJsonPath(path)
    .split(".")
    .map((part) => part.replace(/\[\*\]/g, ""))
    .filter((part) => part && part !== "$");
  const meaningful = parts.filter((part) => !WRAPPER_SEGMENTS.has(part.toLowerCase()));
  const leaf = meaningful[meaningful.length - 1] ?? parts[parts.length - 1] ?? path;
  const parent = meaningful.length > 1 ? meaningful[meaningful.length - 2] : "";
  if (parent && /^[A-Z0-9]{1,4}$/.test(leaf)) {
    return `${humanizeField(parent)} ${humanizeField(leaf)}`;
  }
  return humanizeField(leaf);
}

function humanizeField(raw: string): string {
  if (/^[A-Z0-9]{1,4}$/.test(raw)) {
    return raw;
  }
  const words = raw
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[_\s]+/)
    .filter(Boolean);
  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      return index === 0 ? `${lower.charAt(0).toUpperCase()}${lower.slice(1)}` : lower;
    })
    .join(" ");
}

export function jsonPathLeaf(path: string): string {
  const parts = generalizeJsonPath(path)
    .split(".")
    .map((part) => part.replace(/\[\*\]/g, ""))
    .filter((part) => part && part !== "$");
  const skip = new Set(["value", "values", "total", "data"]);
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    if (!skip.has(parts[i].toLowerCase())) {
      return parts[i];
    }
  }
  return parts[parts.length - 1] ?? "";
}

export function normalizedLeaf(path: string): string {
  return jsonPathLeaf(path).replace(/_/g, "").toLowerCase();
}

const META_LEAF =
  /^(order|index|idx|id|key|x|y|z|lng|lat|lon|zoom|width|height|sort|rank|level|opacity|zindex|page|offset|nth)$/i;

export function isMetadataPath(path: string): boolean {
  return META_LEAF.test(jsonPathLeaf(path));
}

const RESTRICTED_SCHEME =
  /^(chrome|chrome-extension|chrome-untrusted|chrome-search|edge|devtools|view-source|brave|opera|vivaldi):/i;

/** Pages Chrome will not let an extension inject into, including the Web Store. */
export function isUnscriptableUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) {
    return false;
  }
  const scheme = trimmed.slice(0, trimmed.indexOf(":") + 1);
  if (RESTRICTED_SCHEME.test(scheme)) {
    return true;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:" && parsed.protocol !== "file:") {
      return true;
    }
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    if (host === "chromewebstore.google.com") {
      return true;
    }
    if (host === "chrome.google.com" && (path === "/webstore" || path.startsWith("/webstore/"))) {
      return true;
    }
    if (host === "microsoftedge.microsoft.com" && (path === "/addons" || path.startsWith("/addons/"))) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * True only when Chrome has shown us a page URL we are allowed to inject into.
 * The Web Store hides its URL, so a missing URL is not scriptable.
 */
export function canInjectContentScript(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed || isUnscriptableUrl(trimmed)) {
    return false;
  }
  try {
    const protocol = new URL(trimmed).protocol;
    return protocol === "http:" || protocol === "https:" || protocol === "file:";
  } catch {
    return false;
  }
}

/** Chrome's scripting API error when the tab is the Web Store or another blocked page. */
export function isUnscriptableError(error: unknown): boolean {
  return /cannot be scripted|extensions gallery|cannot access a chrome|chromewebstore\.google\.com|chrome\.google\.com\/webstore/i.test(
    errorText(error),
  );
}

function errorText(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return `${error.name} ${error.message}`;
  }
  if (error && typeof error === "object") {
    const message = "message" in error ? String(error.message) : "";
    try {
      return `${message} ${JSON.stringify(error)}`;
    } catch {
      return message;
    }
  }
  return String(error ?? "");
}

export function isXhrOrFetch(resourceType: string): boolean {
  const type = resourceType.toLowerCase();
  return type === "xhr" || type === "fetch";
}
