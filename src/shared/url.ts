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

export function isXhrOrFetch(resourceType: string): boolean {
  const type = resourceType.toLowerCase();
  return type === "xhr" || type === "fetch";
}
