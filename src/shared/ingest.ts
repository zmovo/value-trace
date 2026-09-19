import { isExtensionContextValid } from "./extension-context";
import { flattenJson } from "./json-flatten";
import type { CapturedResponse, RawNetworkCapture } from "./types";

const MAX_BODY_BYTES = 5 * 1024 * 1024;

export function tryParseJson(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[" && !/^-?\d/.test(trimmed))) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

export function capturedFromRaw(tabId: number, raw: RawNetworkCapture): CapturedResponse | null {
  if (!raw.bodyText || raw.bodyText.length > MAX_BODY_BYTES) {
    return null;
  }

  const parsed = tryParseJson(raw.bodyText);
  if (parsed === undefined) {
    return null;
  }

  const entries = flattenJson(parsed).filter((entry) => entry.normalizedValues.length > 0);
  if (entries.length === 0) {
    return null;
  }

  return {
    tabId,
    meta: {
      requestId: createRequestId(),
      url: raw.url,
      method: raw.method.toUpperCase(),
      status: raw.status,
      durationMs: raw.durationMs,
      mimeType: raw.mimeType,
      resourceType: raw.resourceType,
      timestamp: Date.now(),
    },
    responseBody: parsed,
    entries,
  };
}

export function createRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function sendToBackground(message: { type: string; payload: unknown }): void {
  if (!isExtensionContextValid()) {
    return;
  }
  try {
    chrome.runtime.sendMessage(message, () => {
      void chrome.runtime.lastError;
    });
  } catch {
    // Old pages after an extension reload, or a sleeping worker.
  }
}
