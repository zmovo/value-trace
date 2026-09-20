import { startNetworkCollector } from "../devtools/network-collector";
import { isExtensionContextValid, isInvalidatedError } from "../shared/extension-context";
import { MessageType, type PortName } from "../shared/message";
import { showChromeNetwork } from "../shared/reveal";
import type { PanelSelection, TabStatus } from "../shared/types";

const tabId = chrome.devtools.inspectedWindow.tabId;

const startBtn = document.getElementById("start") as HTMLButtonElement;
const stopBtn = document.getElementById("stop") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const emptyEl = document.getElementById("empty") as HTMLDivElement;
const detailEl = document.getElementById("detail") as HTMLDivElement;
const methodEl = document.getElementById("method") as HTMLSpanElement;
const urlEl = document.getElementById("url") as HTMLSpanElement;
const metaEl = document.getElementById("meta") as HTMLDivElement;
const pathEl = document.getElementById("path") as HTMLDivElement;
const jsonEl = document.getElementById("json") as HTMLPreElement;
const openNetworkBtn = document.getElementById("open-network") as HTMLButtonElement;

let currentSelection: PanelSelection | null = null;

let port = connect();
if (isExtensionContextValid()) {
  startNetworkCollector(tabId);
}

function connect(): chrome.runtime.Port | null {
  if (!isExtensionContextValid()) {
    showReloadedMessage();
    return null;
  }

  try {
    const next = chrome.runtime.connect({ name: "panel" as PortName });
    next.postMessage({ type: MessageType.DEVTOOLS_READY, payload: { tabId } });
    next.postMessage({ type: MessageType.GET_STATUS, payload: { tabId } });

    next.onMessage.addListener((message: { type?: string; payload?: unknown }) => {
      if (message.type === MessageType.STATUS) {
        renderStatus(message.payload as TabStatus);
        return;
      }
      if (message.type === MessageType.SELECT_API_SOURCE) {
        renderSelection(message.payload as PanelSelection);
      }
    });

    next.onDisconnect.addListener(() => {
      if (!isExtensionContextValid()) {
        showReloadedMessage();
        return;
      }
      window.setTimeout(() => {
        port = connect();
      }, 400);
    });

    return next;
  } catch (error) {
    if (isInvalidatedError(error)) {
      showReloadedMessage();
      return null;
    }
    throw error;
  }
}

function showReloadedMessage(): void {
  statusEl.textContent = "Extension reloaded — close DevTools, then open it again.";
  emptyEl.hidden = false;
  emptyEl.textContent = "This panel is stale. Close DevTools completely, then reopen it.";
  startBtn.disabled = true;
  stopBtn.disabled = true;
}

function postPanel(type: string): void {
  if (!port || !isExtensionContextValid()) {
    showReloadedMessage();
    return;
  }
  try {
    port.postMessage({ type, payload: { tabId } });
  } catch (error) {
    if (isInvalidatedError(error)) {
      showReloadedMessage();
    }
  }
}

startBtn.addEventListener("click", () => {
  postPanel(MessageType.INSPECT_MODE_START);
});

stopBtn.addEventListener("click", () => {
  postPanel(MessageType.INSPECT_MODE_STOP);
});

openNetworkBtn.addEventListener("click", () => {
  if (!currentSelection) {
    return;
  }
  void showChromeNetwork(currentSelection.meta.method, currentSelection.meta.url);
});

function renderStatus(status: TabStatus): void {
  const inspect = status.inspectActive ? "Inspect ON" : "Inspect OFF";
  const last = status.lastCaptureUrl ? ` · last ${displayUrl(status.lastCaptureUrl)}` : "";
  statusEl.textContent = `${status.valueCount} indexed values · ${status.requestCount} requests · ${inspect}${last}`;
  startBtn.disabled = status.inspectActive;
  stopBtn.disabled = !status.inspectActive;

  if (!detailEl.hidden) {
    return;
  }
  if (status.valueCount === 0) {
    emptyEl.textContent =
      "No APIs yet. Use the page, then Start Inspect from the toolbar icon.";
  } else {
    emptyEl.textContent = "Click a match on the page to open the full JSON here.";
  }
}

function renderSelection(selection: PanelSelection): void {
  currentSelection = selection;
  emptyEl.hidden = true;
  detailEl.hidden = false;
  methodEl.textContent = selection.meta.method;
  urlEl.textContent = displayUrl(selection.meta.url);
  const duration = selection.meta.durationMs ? `${Math.round(selection.meta.durationMs)}ms` : "—";
  metaEl.textContent = `Status ${selection.meta.status} · Duration ${duration}`;
  pathEl.textContent = `${selection.jsonPath} = ${selection.rawValue}`;
  jsonEl.replaceChildren(renderJson(selection.responseBody, selection.jsonPath));
  window.requestAnimationFrame(() => {
    const hit = jsonEl.querySelector(".json-hit");
    hit?.scrollIntoView({ block: "center" });
  });
}

function displayUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

function renderJson(value: unknown, highlightPath: string): DocumentFragment {
  const root = document.createDocumentFragment();
  root.appendChild(renderNode(value, "$", highlightPath, 0));
  return root;
}

function renderNode(value: unknown, path: string, highlightPath: string, indent: number): Node {
  if (value === null) {
    return token("null", "null", path, highlightPath);
  }
  if (typeof value === "boolean") {
    return token(String(value), "bool", path, highlightPath);
  }
  if (typeof value === "number") {
    return token(String(value), "num", path, highlightPath);
  }
  if (typeof value === "string") {
    return token(JSON.stringify(value), "str", path, highlightPath);
  }
  if (Array.isArray(value)) {
    return renderCollection(value, path, highlightPath, indent, true);
  }
  if (typeof value === "object") {
    return renderCollection(value as Record<string, unknown>, path, highlightPath, indent, false);
  }
  return token(String(value), "", path, highlightPath);
}

function renderCollection(
  value: unknown[] | Record<string, unknown>,
  path: string,
  highlightPath: string,
  indent: number,
  isArray: boolean,
): HTMLElement {
  const wrap = document.createElement("span");
  const entries = isArray
    ? (value as unknown[]).map((item, index) => [`${index}`, item] as const)
    : Object.entries(value as Record<string, unknown>);

  wrap.appendChild(text(isArray ? "[" : "{"));
  if (entries.length === 0) {
    wrap.appendChild(text(isArray ? "]" : "}"));
    return wrap;
  }

  entries.forEach(([key, child], index) => {
    wrap.appendChild(document.createElement("br"));
    wrap.appendChild(text(pad(indent + 1)));
    const childPath = isArray ? `${path}[${key}]` : joinPath(path, key);
    if (!isArray) {
      const keyNode = token(JSON.stringify(key), "key", childPath, highlightPath);
      wrap.appendChild(keyNode);
      wrap.appendChild(text(": "));
    }
    wrap.appendChild(renderNode(child, childPath, highlightPath, indent + 1));
    if (index < entries.length - 1) {
      wrap.appendChild(text(","));
    }
  });

  wrap.appendChild(document.createElement("br"));
  wrap.appendChild(text(`${pad(indent)}${isArray ? "]" : "}"}`));
  return wrap;
}

function joinPath(parent: string, key: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return `${parent}.${key}`;
  }
  return `${parent}['${key.replace(/'/g, "\\'")}']`;
}

function token(value: string, kind: string, path: string, highlightPath: string): HTMLElement {
  const span = document.createElement("span");
  span.className = kind ? `json-${kind}` : "";
  span.textContent = value;
  if (path === highlightPath) {
    span.classList.add("json-hit");
  }
  return span;
}

function text(value: string): Text {
  return document.createTextNode(value);
}

function pad(indent: number): string {
  return "  ".repeat(indent);
}

window.addEventListener("error", (event) => {
  if (isInvalidatedError(event.error) || isInvalidatedError(event.message)) {
    event.preventDefault();
    showReloadedMessage();
    return;
  }
});
