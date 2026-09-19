import { isExtensionContextValid, isInvalidatedError } from "../shared/extension-context";
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

  chrome.runtime.onMessage.addListener(
    (message: { type?: string; payload?: { tabId?: number } }, _sender, sendResponse) => {
      try {
        if (!isExtensionContextValid()) {
          inspector.stop();
          return false;
        }
        if (message?.type === MessageType.INSPECT_MODE_START) {
          inspector.start(message.payload?.tabId);
          sendResponse({ ok: true });
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
        } satisfies RawNetworkCapture,
      });
    } catch (error) {
      logError("Page capture bridge failed", error);
    }
  });
}
