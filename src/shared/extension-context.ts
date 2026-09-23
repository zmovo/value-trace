let alive = true;

export function markExtensionContextDead(): void {
  alive = false;
}

export function isExtensionContextValid(): boolean {
  if (!alive) {
    return false;
  }
  try {
    if (typeof chrome === "undefined" || !chrome.runtime?.id) {
      alive = false;
      return false;
    }
    return true;
  } catch {
    alive = false;
    return false;
  }
}

export function isInvalidatedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("Extension context invalidated");
}
