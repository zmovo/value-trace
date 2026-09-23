import { isExtensionContextValid, isInvalidatedError, markExtensionContextDead } from "../shared/extension-context";
import { sendToBackground } from "../shared/ingest";
import { logError } from "../shared/logger";
import { MessageType } from "../shared/message";
import type { RawNetworkCapture } from "../shared/types";
import { Inspector } from "./inspector";

const isolated = globalThis as typeof globalThis & {
  __valueTraceBooted?: boolean;
  __valueTraceInspector?: Inspector;
};
const inspector = isolated.__valueTraceInspector ?? new Inspector();
isolated.__valueTraceInspector = inspector;

if (!isolated.__valueTraceBooted) {
  isolated.__valueTraceBooted = true;
  watchExtensionContext();
  announceReady();

  chrome.runtime.onMessage.addListener(
    (message: { type?: string; payload?: { tabId?: number } }, _sender, sendResponse) => {
      try {
        if (!isExtensionContextValid()) {
          inspector.stop();
          sendResponse({ ok: false });
          return false;
        }
        if (message?.type === MessageType.INSPECT_MODE_START) {
          sendResponse({ ok: inspector.start(message.payload?.tabId) });
          return false;
        }
        if (message?.type === MessageType.INSPECT_MODE_STOP) {
          inspector.stop();
          sendResponse({ ok: true });
          return false;
        }
      } catch (error) {
        if (!isInvalidatedError(error)) {
          logError("Content message failed", error);
        }
      }
      return false;
    },
  );

  window.addEventListener("message", (event: MessageEvent) => {
    try {
      if (event.source !== window || event.origin !== window.location.origin) {
        return;
      }
      const data = event.data as { source?: string; type?: string } & Partial<RawNetworkCapture>;
      if (data?.source !== "valuetrace-page" || data.type !== "CAPTURE") {
        return;
      }
      if (!data.url || !data.bodyText || !data.method) {
        return;
      }
      if (!isExtensionContextValid()) {
        return;
      }
      sendToBackground({
        type: MessageType.NETWORK_RAW_CAPTURED,
        payload: {
          url: data.url,
          method: data.method,
          status: data.status ?? 0,
          durationMs: data.durationMs ?? 0,
          mimeType: data.mimeType ?? "",
          resourceType: data.resourceType ?? "fetch",
          bodyText: data.bodyText,
          requestText: typeof data.requestText === "string" ? data.requestText : "",
        } satisfies RawNetworkCapture,
      });
    } catch (error) {
      if (isInvalidatedError(error)) {
        markExtensionContextDead();
        return;
      }
      logError("Page capture bridge failed", error);
    }
  });
}

function announceReady(): void {
  try {
    if (!isExtensionContextValid()) {
      return;
    }
    chrome.runtime.sendMessage({ type: MessageType.CONTENT_READY });
  } catch (error) {
    if (isInvalidatedError(error)) {
      markExtensionContextDead();
    }
  }
}

function watchExtensionContext(): void {
  const connect = (): void => {
    try {
      const port = chrome.runtime.connect({ name: "inspect" });
      port.onDisconnect.addListener(() => {
        // The service worker going idle closes this port. That is not an
        // extension reload, so keep the content script able to start inspect.
        if (!isExtensionContextValid()) {
          inspector.stop();
          return;
        }
        window.setTimeout(connect, 300);
      });
    } catch (error) {
      if (isInvalidatedError(error) || !isExtensionContextValid()) {
        markExtensionContextDead();
        inspector.stop();
        return;
      }
      logError("Could not watch extension context", error);
    }
  };
  connect();
}
