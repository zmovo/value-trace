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

export function isXhrOrFetch(resourceType: string): boolean {
  const type = resourceType.toLowerCase();
  return type === "xhr" || type === "fetch";
}
