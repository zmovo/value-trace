export function networkFilter(method: string, url: string): string {
  try {
    const parsed = new URL(url);
    return `method:${method} ${parsed.pathname}${parsed.search}`;
  } catch {
    return `method:${method} ${url}`;
  }
}

/**
 * Chrome's public DevTools API cannot select a specific request or Response
 * field. `panels.network.show({ filter })` is the closest: it opens Network
 * and applies a filter so the matching API is in view.
 */
export async function showChromeNetwork(method: string, url: string): Promise<boolean> {
  const network = (
    chrome.devtools.panels as unknown as {
      network?: { show?: (options?: { filter: string }) => Promise<void> };
    }
  ).network;
  if (typeof network?.show !== "function") {
    return false;
  }
  await network.show({ filter: networkFilter(method, url) });
  return true;
}

export function showExtensionPanel(panel: { show?: () => void } | null): void {
  try {
    panel?.show?.();
  } catch {
    // Older Chrome builds do not expose ExtensionPanel.show().
  }
}
