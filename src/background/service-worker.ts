import { exchangeFilename, formatExchangeText } from "../shared/exchange";
import { capturedFromRaw } from "../shared/ingest";
import { log, logError } from "../shared/logger";
import { MessageType, type PortName } from "../shared/message";
import type {
  CapturedResponse,
  ExchangeRequest,
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
const recentCaptures = new Map<string, { at: number; tabId: number; requestId: string }>();
const lastCaptureUrls = new Map<number, string>();
let inspectingTabId: number | null = null;

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
    const response = (await chrome.tabs.sendMessage(tabId, message, { frameId: 0 })) as { ok?: boolean } | undefined;
    return response?.ok === true;
  } catch {
    return false;
  }
}

async function injectContent(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    files: ["content.js"],
  });
}

async function setInspect(tabId: number, active: boolean): Promise<boolean> {
  if (active && inspectingTabId != null && inspectingTabId !== tabId) {
    await applyInspect(inspectingTabId, false);
  }
  return applyInspect(tabId, active);
}

async function applyInspect(tabId: number, active: boolean): Promise<boolean> {
  const type = active ? MessageType.INSPECT_MODE_START : MessageType.INSPECT_MODE_STOP;
  let delivered = await sendToTab(tabId, { type, payload: { tabId } });
  if (!delivered && active) {
    try {
      await injectContent(tabId);
      delivered = await sendToTab(tabId, { type, payload: { tabId } });
    } catch (error) {
      logError("Could not inject content script", error);
    }
  }
  const state = stateFor(tabId);
  const on = active && delivered;
  state.inspectActive = on;
  if (on) {
    inspectingTabId = tabId;
  } else if (inspectingTabId === tabId) {
    inspectingTabId = null;
  }
  log(on ? "Inspect mode started" : active ? "Inspect mode did not start" : "Inspect mode stopped", tabId);
  broadcastStatus(tabId);
  return !active || delivered;
}

function stopInspectOnFullNavigation(tabId: number): void {
  if (!tabs.get(tabId)?.inspectActive) {
    return;
  }
  void setInspect(tabId, false);
}

function captureKey(payload: CapturedResponse): string {
  return `${payload.tabId}|${payload.meta.method}|${payload.meta.url}|${JSON.stringify(payload.responseBody)}`;
}

function handleCaptured(payload: CapturedResponse): void {
  const key = captureKey(payload);
  const now = Date.now();
  const previous = recentCaptures.get(key);
  if (previous && now - previous.at < 2000) {
    if (payload.requestBody) {
      stateFor(previous.tabId).index.setRequestBody(previous.requestId, payload.requestBody);
    }
    return;
  }
  recentCaptures.set(key, {
    at: now,
    tabId: payload.tabId,
    requestId: payload.meta.requestId,
  });

  const state = stateFor(payload.tabId);
  const added = state.index.addCaptured(payload);
  lastCaptureUrls.set(payload.tabId, payload.meta.url);
  log("Network captured");
  log("Indexed", added, "values");
  broadcastStatus(payload.tabId);
}

async function downloadExchange(
  tabId: number,
  requestId: string,
): Promise<{ ok: boolean; filename?: string; text?: string }> {
  const exchange = stateFor(tabId).index.getExchange(requestId);
  if (!exchange) {
    return { ok: false };
  }
  const text = formatExchangeText(exchange);
  const filename = exchangeFilename(exchange.method, exchange.url);
  try {
    // Service workers have no URL.createObjectURL. chrome.downloads accepts a data URL.
    await chrome.downloads.download({
      url: textToDataUrl(text),
      filename,
      saveAs: false,
      conflictAction: "uniquify",
    });
    return { ok: true };
  } catch (error) {
    logError("Download failed", error);
    return { ok: false, filename, text };
  }
}

function textToDataUrl(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return `data:text/plain;charset=utf-8;base64,${btoa(binary)}`;
}

chrome.runtime.onConnect.addListener((port) => {
  const name = port.name as PortName;
  if (name === "inspect") {
    return;
  }
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
          payload.hints,
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
        void setInspect(payload.tabId, true).then((started) => {
          sendResponse({ ok: started, payload: statusOf(payload.tabId) });
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

      if (message.type === MessageType.GET_REQUEST_SNAPSHOT) {
        const payload = message.payload as ExchangeRequest;
        const tabId = payload?.tabId ?? sender.tab?.id;
        const exchange =
          tabId == null || !payload?.requestId
            ? null
            : stateFor(tabId).index.getExchange(payload.requestId);
        sendResponse(
          exchange
            ? { ok: true, url: exchange.url, method: exchange.method, requestBody: exchange.requestBody }
            : { ok: false },
        );
        return false;
      }

      if (message.type === MessageType.GET_REQUEST_EXCHANGE) {
        const payload = message.payload as ExchangeRequest;
        const tabId = payload?.tabId ?? sender.tab?.id;
        if (tabId == null || !payload?.requestId) {
          sendResponse({ ok: false });
          return false;
        }
        void downloadExchange(tabId, payload.requestId).then((result) => {
          sendResponse(result);
        });
        return true;
      }
    } catch (error) {
      logError("Runtime message failed", error);
    }
    return false;
  },
);

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) {
    return;
  }
  stopInspectOnFullNavigation(details.tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (inspectingTabId === tabId) {
    inspectingTabId = null;
  }
  tabs.delete(tabId);
  lastSelections.delete(tabId);
  lastCaptureUrls.delete(tabId);
  panelPorts.delete(tabId);
  devtoolsPorts.delete(tabId);
});
