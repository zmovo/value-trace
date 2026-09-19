import { isExtensionContextValid, isInvalidatedError } from "../shared/extension-context";
import { sendToBackground } from "../shared/ingest";
import { log, logError } from "../shared/logger";
import { MessageType, type PortName } from "../shared/message";
import { showChromeNetwork, showExtensionPanel } from "../shared/reveal";
import type { PanelSelection } from "../shared/types";
import { startNetworkCollector } from "./network-collector";

const tabId = chrome.devtools.inspectedWindow.tabId;
let apiPanel: chrome.devtools.panels.ExtensionPanel | null = null;

function connect(): void {
  if (!isExtensionContextValid()) {
    return;
  }
  try {
    const port = chrome.runtime.connect({ name: "devtools" as PortName });
    port.postMessage({
      type: MessageType.DEVTOOLS_READY,
      payload: { tabId },
    });
    port.onMessage.addListener((message: { type?: string; payload?: unknown }) => {
      if (message.type === MessageType.SELECT_API_SOURCE) {
        void revealSelection(message.payload as PanelSelection);
      }
    });
    port.onDisconnect.addListener(() => {
      if (!isExtensionContextValid()) {
        return;
      }
      window.setTimeout(connect, 400);
    });
  } catch (error) {
    if (!isInvalidatedError(error)) {
      logError("DevTools port failed", error);
    }
  }
}

async function revealSelection(selection: PanelSelection): Promise<void> {
  try {
    await showChromeNetwork(selection.meta.method, selection.meta.url);
  } catch (error) {
    logError("Network panel filter failed", error);
  }
  showExtensionPanel(apiPanel);
}

connect();
sendToBackground({ type: MessageType.DEVTOOLS_READY, payload: { tabId } });
startNetworkCollector(tabId);

try {
  chrome.devtools.panels.create("API Source", "", "panel.html", (panel) => {
    apiPanel = panel;
    log("API Source panel created");
  });
} catch (error) {
  logError("Failed to create API Source panel", error);
}
