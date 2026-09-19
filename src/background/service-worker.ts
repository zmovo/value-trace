import { capturedFromRaw } from "../shared/ingest";
import { log, logError } from "../shared/logger";
import { MessageType, type PortName } from "../shared/message";
import type {
  CapturedResponse,
  InspectPayload,
  LookupRequest,
  PanelSelection,
  RawNetworkCapture,
  SelectSourcePayload,
  TabStatus,
} from "../shared/types";
import { ValueIndex } from "../shared/value-index";

interface TabState {
  index: ValueIndex;
  inspectActive: boolean;
  hasDevTools: boolean;
}

const tabs = new Map<number, TabState>();
const panelPorts = new Map<number, Set<chrome.runtime.Port>>();
const devtoolsPorts = new Map<number, Set<chrome.runtime.Port>>();
const lastSelections = new Map<number, PanelSelection>();
const recentCaptures = new Map<string, number>();
const lastCaptureUrls = new Map<number, string>();

function stateFor(tabId: number): TabState {
  const existing = tabs.get(tabId);
  if (existing) {
    return existing;
  }
  const created: TabState = {
    index: new ValueIndex(),
    inspectActive: false,
    hasDevTools: false,
  };
  tabs.set(tabId, created);
  return created;
}

function statusOf(tabId: number): TabStatus {
  const state = stateFor(tabId);
  const stats = state.index.stats();
  return {
    tabId,
    requestCount: stats.requestCount,
    valueCount: stats.valueCount,
    inspectActive: state.inspectActive,
    hasDevTools: state.hasDevTools,
    lastCaptureUrl: lastCaptureUrls.get(tabId) ?? "",
  };
}

function broadcastStatus(tabId: number): void {
  const message = { type: MessageType.STATUS, payload: statusOf(tabId) };
  const ports = panelPorts.get(tabId);
  if (!ports) {
    return;
  }
  for (const port of ports) {
    try {
      port.postMessage(message);
    } catch (error) {
      logError("Failed to notify panel", error);
    }
  }
}

function rememberPort(
  store: Map<number, Set<chrome.runtime.Port>>,
  tabId: number,
  port: chrome.runtime.Port,
): void {
  const set = store.get(tabId) ?? new Set();
  set.add(port);
  store.set(tabId, set);
}

function forgetPort(
  store: Map<number, Set<chrome.runtime.Port>>,
  tabId: number,
  port: chrome.runtime.Port,
): void {
  const set = store.get(tabId);
  if (!set) {
    return;
  }
  set.delete(port);
  if (set.size === 0) {
    store.delete(tabId);
  }
}

function broadcastSelection(tabId: number, selection: PanelSelection): void {
  const outbound = { type: MessageType.SELECT_API_SOURCE, payload: selection };
  for (const port of [...(panelPorts.get(tabId) ?? []), ...(devtoolsPorts.get(tabId) ?? [])]) {
    try {
      port.postMessage(outbound);
    } catch (error) {
      logError("Failed to notify selection", error);
    }
  }
}

async function sendToTab(tabId: number, message: { type: string; payload?: unknown }): Promise<boolean> {
  try {
    await chrome.tabs.sendMessage(tabId, message);
    return true;
  } catch {
    return false;
  }
}

async function injectContent(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"],
  });
}

async function setInspect(tabId: number, active: boolean): Promise<void> {
  const state = stateFor(tabId);
  state.inspectActive = active;
  const type = active ? MessageType.INSPECT_MODE_START : MessageType.INSPECT_MODE_STOP;
  let ok = await sendToTab(tabId, { type, payload: { tabId } });
  if (!ok && active) {
    try {
      await injectContent(tabId);
      ok = await sendToTab(tabId, { type, payload: { tabId } });
    } catch (error) {
      logError("Could not inject content script", error);
    }
  }
  log(active ? "Inspect mode started" : "Inspect mode stopped", tabId);
  broadcastStatus(tabId);
}

function captureKey(payload: CapturedResponse): string {
  return `${payload.tabId}|${payload.meta.method}|${payload.meta.url}|${JSON.stringify(payload.responseBody)}`;
}

function handleCaptured(payload: CapturedResponse): void {
  const key = captureKey(payload);
  const now = Date.now();
  const previous = recentCaptures.get(key);
  if (previous && now - previous < 2000) {
    return;
  }
  recentCaptures.set(key, now);

  const state = stateFor(payload.tabId);
  const added = state.index.addCaptured(payload);
  lastCaptureUrls.set(payload.tabId, payload.meta.url);
  log("Network captured");
  log("Indexed", added, "values");
  broadcastStatus(payload.tabId);
}

chrome.runtime.onConnect.addListener((port) => {
  const name = port.name as PortName;
  let boundTabId: number | null = null;

  port.onMessage.addListener((message: { type?: string; payload?: unknown }) => {
    try {
      if (!message || typeof message.type !== "string") {
        return;
      }

      if (message.type === MessageType.DEVTOOLS_READY) {
        const payload = message.payload as InspectPayload;
        boundTabId = payload.tabId;
        const state = stateFor(boundTabId);
        if (name === "devtools" || name === "panel") {
          state.hasDevTools = true;
        }
        if (name === "devtools") {
          rememberPort(devtoolsPorts, boundTabId, port);
        }
        if (name === "panel") {
          rememberPort(panelPorts, boundTabId, port);
          const selection = lastSelections.get(boundTabId);
          if (selection) {
            port.postMessage({ type: MessageType.SELECT_API_SOURCE, payload: selection });
          }
        }
        broadcastStatus(boundTabId);
        return;
      }

      if (message.type === MessageType.NETWORK_RESPONSE_CAPTURED) {
        handleCaptured(message.payload as CapturedResponse);
        return;
      }

      if (message.type === MessageType.INDEX_CLEARED) {
        const payload = message.payload as InspectPayload;
        stateFor(payload.tabId).index.clear();
        lastSelections.delete(payload.tabId);
        log("Index cleared", payload.tabId);
        broadcastStatus(payload.tabId);
        return;
      }

      if (message.type === MessageType.INSPECT_MODE_START) {
        const payload = message.payload as InspectPayload;
        void setInspect(payload.tabId, true);
        return;
      }

      if (message.type === MessageType.INSPECT_MODE_STOP) {
        const payload = message.payload as InspectPayload;
        void setInspect(payload.tabId, false);
        return;
      }

      if (message.type === MessageType.GET_STATUS) {
        const payload = message.payload as InspectPayload;
        port.postMessage({ type: MessageType.STATUS, payload: statusOf(payload.tabId) });
        return;
      }

      if (message.type === MessageType.SELECT_API_SOURCE) {
        const payload = message.payload as SelectSourcePayload;
        const selection = stateFor(payload.tabId).index.getSelection(
          payload.requestId,
          payload.jsonPath,
        );
        if (!selection) {
          return;
        }
        lastSelections.set(payload.tabId, selection);
        broadcastSelection(payload.tabId, selection);
      }
    } catch (error) {
      logError("Port message failed", error);
    }
  });

  port.onDisconnect.addListener(() => {
    if (boundTabId == null) {
      return;
    }
    if (name === "panel") {
      forgetPort(panelPorts, boundTabId, port);
    }
    if (name === "devtools") {
      forgetPort(devtoolsPorts, boundTabId, port);
    }
    if (name === "devtools") {
      const remainingPanels = panelPorts.get(boundTabId);
      if (remainingPanels && remainingPanels.size > 0) {
        return;
      }
      const state = stateFor(boundTabId);
      state.hasDevTools = false;
      state.index.clear();
      lastSelections.delete(boundTabId);
      lastCaptureUrls.delete(boundTabId);
      if (state.inspectActive) {
        void setInspect(boundTabId, false);
      }
      log("DevTools closed, index cleared", boundTabId);
      broadcastStatus(boundTabId);
    }
  });
});

chrome.runtime.onMessage.addListener(
  (message: { type?: string; payload?: unknown }, sender, sendResponse) => {
    try {
      if (!message || typeof message.type !== "string") {
        return false;
      }

      if (message.type === MessageType.DEVTOOLS_READY) {
        const payload = message.payload as InspectPayload;
        if (payload?.tabId != null) {
          stateFor(payload.tabId).hasDevTools = true;
          broadcastStatus(payload.tabId);
        }
        return false;
      }

      if (message.type === MessageType.NETWORK_RESPONSE_CAPTURED) {
        handleCaptured(message.payload as CapturedResponse);
        sendResponse({ ok: true });
        return false;
      }

      if (message.type === MessageType.NETWORK_RAW_CAPTURED) {
        const tabId = sender.tab?.id;
        if (tabId != null) {
          const captured = capturedFromRaw(tabId, message.payload as RawNetworkCapture);
          if (captured) {
            handleCaptured(captured);
          }
        }
        sendResponse({ ok: true });
        return false;
      }

      if (message.type === MessageType.INDEX_CLEARED) {
        const payload = message.payload as InspectPayload;
        stateFor(payload.tabId).index.clear();
        lastSelections.delete(payload.tabId);
        lastCaptureUrls.delete(payload.tabId);
        broadcastStatus(payload.tabId);
        return false;
      }

      if (message.type === MessageType.VALUE_LOOKUP_REQUEST) {
        const payload = message.payload as LookupRequest;
        const tabId = payload.tabId ?? sender.tab?.id;
        if (tabId == null) {
          sendResponse({ type: MessageType.VALUE_LOOKUP_RESULT, payload: { matches: [] } });
          return false;
        }
        const matches = stateFor(tabId).index.lookup(
          payload.keys,
          payload.primaryKey,
          payload.pageUrl,
        );
        if (matches.length > 0) {
          log("Found", matches.length, "matches");
        }
        sendResponse({
          type: MessageType.VALUE_LOOKUP_RESULT,
          payload: { matches },
        });
        return false;
      }

      if (message.type === MessageType.INSPECT_MODE_START) {
        const payload = message.payload as InspectPayload;
        void setInspect(payload.tabId, true).then(() => {
          sendResponse({ ok: true, payload: statusOf(payload.tabId) });
        });
        return true;
      }

      if (message.type === MessageType.INSPECT_MODE_STOP) {
        const payload = message.payload as InspectPayload;
        void setInspect(payload.tabId, false).then(() => {
          sendResponse({ ok: true, payload: statusOf(payload.tabId) });
        });
        return true;
      }

      if (message.type === MessageType.GET_STATUS) {
        const payload = message.payload as InspectPayload;
        sendResponse({ type: MessageType.STATUS, payload: statusOf(payload.tabId) });
        return false;
      }

      if (message.type === MessageType.SELECT_API_SOURCE) {
        const payload = message.payload as SelectSourcePayload;
        const tabId = payload.tabId ?? sender.tab?.id;
        if (tabId == null) {
          sendResponse({ ok: false });
          return false;
        }
        const selection: PanelSelection | null = stateFor(tabId).index.getSelection(
          payload.requestId,
          payload.jsonPath,
        );
        if (selection) {
          lastSelections.set(tabId, selection);
          broadcastSelection(tabId, selection);
        }
        sendResponse({ ok: Boolean(selection) });
        return false;
      }
    } catch (error) {
      logError("Runtime message failed", error);
    }
    return false;
  },
);
