import { isExtensionContextValid } from "../shared/extension-context";
import { MessageType } from "../shared/message";
import type { TabStatus } from "../shared/types";

const startBtn = document.getElementById("start") as HTMLButtonElement;
const stopBtn = document.getElementById("stop") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLDivElement;

async function activeTabId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

async function refresh(): Promise<void> {
  if (!isExtensionContextValid()) {
    statusEl.textContent = "Extension reloaded. Close this popup and try again.";
    return;
  }
  const tabId = await activeTabId();
  if (tabId == null) {
    statusEl.textContent = "No active tab.";
    return;
  }
  chrome.runtime.sendMessage(
    { type: MessageType.GET_STATUS, payload: { tabId } },
    (response: { payload?: TabStatus }) => {
      if (chrome.runtime.lastError || !response?.payload) {
        statusEl.textContent = "Open DevTools to start capturing APIs.";
        return;
      }
      const status = response.payload;
      statusEl.textContent = status.hasDevTools
        ? `${status.valueCount} values indexed · ${status.inspectActive ? "Inspect ON" : "Inspect OFF"}`
        : "Open DevTools → API Source, then refresh the page.";
      startBtn.disabled = status.inspectActive;
      stopBtn.disabled = !status.inspectActive;
    },
  );
}

startBtn.addEventListener("click", async () => {
  const tabId = await activeTabId();
  if (tabId == null) {
    return;
  }
  chrome.runtime.sendMessage({ type: MessageType.INSPECT_MODE_START, payload: { tabId } }, () => {
    void refresh();
  });
});

stopBtn.addEventListener("click", async () => {
  const tabId = await activeTabId();
  if (tabId == null) {
    return;
  }
  chrome.runtime.sendMessage({ type: MessageType.INSPECT_MODE_STOP, payload: { tabId } }, () => {
    void refresh();
  });
});

void refresh();
