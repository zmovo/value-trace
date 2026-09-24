import { isExtensionContextValid } from "../shared/extension-context";
import { MessageType } from "../shared/message";
import type { TabStatus } from "../shared/types";

const actionBtn = document.getElementById("action") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const statusLabel = document.getElementById("status-label") as HTMLSpanElement;
const hintLabel = document.getElementById("hint-label") as HTMLSpanElement;

const READY_HINT = "Then click a number on the page";

function paint(
  mode: "ready" | "on" | "warn",
  label: string,
  hint: string,
  action: string,
  enabled: boolean,
): void {
  statusEl.dataset.mode = mode;
  statusLabel.textContent = label;
  hintLabel.textContent = hint;
  actionBtn.textContent = action;
  actionBtn.disabled = !enabled;
  actionBtn.classList.toggle("is-stop", mode === "on");
  actionBtn.dataset.action = mode === "on" ? "stop" : "start";
}

async function activeTabId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

function showStatus(status: TabStatus): void {
  if (status.restricted) {
    paint("warn", "Unavailable", "Chrome blocks extensions on this page", "Start Inspect", false);
    return;
  }
  if (status.inspectActive) {
    paint("on", "Inspecting", "Click a number on the page", "Stop Inspect", true);
    return;
  }
  paint("ready", "Ready", READY_HINT, "Start Inspect", true);
}

async function refresh(): Promise<void> {
  if (!isExtensionContextValid()) {
    paint("warn", "Reload", "Close this popup and open ValueTrace again", "Start Inspect", false);
    return;
  }
  const tabId = await activeTabId();
  if (tabId == null) {
    paint("warn", "No tab", "Open a page, then start inspect", "Start Inspect", false);
    return;
  }
  chrome.runtime.sendMessage(
    { type: MessageType.GET_STATUS, payload: { tabId } },
    (response: { payload?: TabStatus }) => {
      if (chrome.runtime.lastError || !response?.payload) {
        paint("ready", "Ready", READY_HINT, "Start Inspect", true);
        return;
      }
      showStatus(response.payload);
    },
  );
}

actionBtn.addEventListener("click", async () => {
  const tabId = await activeTabId();
  if (tabId == null) {
    return;
  }
  const stopping = actionBtn.dataset.action === "stop";
  const type = stopping ? MessageType.INSPECT_MODE_STOP : MessageType.INSPECT_MODE_START;
  chrome.runtime.sendMessage({ type, payload: { tabId } }, (response: { ok?: boolean; payload?: TabStatus }) => {
    if (response?.payload?.restricted) {
      showStatus(response.payload);
      return;
    }
    if (!stopping && (chrome.runtime.lastError || response?.ok === false)) {
      paint("warn", "Not started", "Refresh the page, then try again", "Start Inspect", true);
      return;
    }
    if (response?.payload) {
      showStatus(response.payload);
      return;
    }
    void refresh();
  });
});

void refresh();
