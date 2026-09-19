import { isExtensionContextValid } from "../shared/extension-context";
import { createRequestId, sendToBackground, tryParseJson } from "../shared/ingest";
import { flattenJson } from "../shared/json-flatten";
import { log, logError } from "../shared/logger";
import { MessageType } from "../shared/message";
import type { CapturedResponse, RequestMeta } from "../shared/types";

const MAX_BODY_BYTES = 5 * 1024 * 1024;

interface HarLikeRequest {
  request: { url: string; method: string };
  response: {
    status: number;
    content: { mimeType?: string; size?: number; text?: string };
  };
  time?: number;
  getContent: (callback: (content: string, encoding?: string) => void) => void;
  _resourceType?: string;
}

export function startNetworkCollector(tabId: number): void {
  const root = globalThis as typeof globalThis & { __valueTraceCollector?: boolean };
  if (root.__valueTraceCollector) {
    return;
  }
  root.__valueTraceCollector = true;

  chrome.devtools.network.onRequestFinished.addListener((request) => {
    if (!isExtensionContextValid()) {
      return;
    }
    void captureRequest(tabId, request as unknown as HarLikeRequest);
  });

  chrome.devtools.network.onNavigated.addListener((url) => {
    log("Page navigated, clearing index", url);
    sendToBackground({
      type: MessageType.INDEX_CLEARED,
      payload: { tabId },
    });
  });
}

async function captureRequest(tabId: number, request: HarLikeRequest): Promise<void> {
  try {
    const url = request.request.url;
    if (!url.startsWith("http")) {
      return;
    }

    const method = request.request.method.toUpperCase();
    if (method === "OPTIONS") {
      return;
    }

    const declaredSize = request.response.content.size ?? 0;
    if (declaredSize > MAX_BODY_BYTES) {
      log("Skipped large response", url, declaredSize);
      return;
    }

    const mimeType = request.response.content.mimeType ?? "";
    const body = await readBody(request);
    if (body == null || body.length === 0) {
      return;
    }
    if (body.length > MAX_BODY_BYTES) {
      log("Skipped large response body", url, body.length);
      return;
    }

    const parsed = tryParseJson(body);
    if (parsed === undefined) {
      return;
    }

    const entries = flattenJson(parsed).filter((entry) => entry.normalizedValues.length > 0);
    if (entries.length === 0) {
      return;
    }

    const meta: RequestMeta = {
      requestId: createRequestId(),
      url,
      method,
      status: request.response.status,
      durationMs: typeof request.time === "number" ? Math.max(0, request.time) : 0,
      mimeType,
      resourceType: request._resourceType ?? inferResourceType(mimeType),
      timestamp: Date.now(),
    };

    const payload: CapturedResponse = {
      tabId,
      meta,
      responseBody: parsed,
      entries,
    };

    log("Network captured", method, url);
    log("Indexed", entries.length, "values");
    sendToBackground({ type: MessageType.NETWORK_RESPONSE_CAPTURED, payload });
  } catch (error) {
    logError("Network capture failed", error);
  }
}

function readBody(request: HarLikeRequest): Promise<string | null> {
  const embedded = request.response.content.text;
  if (embedded) {
    return Promise.resolve(embedded);
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };

    window.setTimeout(() => finish(null), 2000);

    try {
      request.getContent((content, encoding) => {
        try {
          if (!content) {
            finish(null);
            return;
          }
          if (encoding === "base64") {
            finish(decodeBase64(content));
            return;
          }
          finish(content);
        } catch {
          finish(null);
        }
      });
    } catch {
      finish(null);
    }
  });
}

function inferResourceType(mimeType: string): string {
  return /json/i.test(mimeType) ? "fetch" : "";
}

function decodeBase64(content: string): string {
  const binary = atob(content);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}
