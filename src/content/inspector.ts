import { isExtensionContextValid, isInvalidatedError } from "../shared/extension-context";
import { log, logError } from "../shared/logger";
import { MessageType } from "../shared/message";
import type { LookupResult, ValueMatch } from "../shared/types";
import { Overlay } from "./overlay";
import { isExtensionNode, resolveHoveredValue } from "./value-parser";

const MOVE_THROTTLE_MS = 40;
const HIDE_DELAY_MS = 280;

export class Inspector {
  private readonly overlay = new Overlay();
  private active = false;
  private lastKey = "";
  private lastMove = 0;
  private lastElement: Element | null = null;
  private hideTimer: number | null = null;
  private tabId: number | null = null;

  start(tabId?: number): void {
    if (this.active) {
      return;
    }
    this.tabId = tabId ?? this.tabId;
    this.active = true;
    this.resetHover();
    this.overlay.mount((detail) => this.select(detail.match));
    this.overlay.setInspecting(true);
    document.addEventListener("mousemove", this.onMove, true);
    document.addEventListener("mouseover", this.onMove, true);
    document.addEventListener("click", this.onClick, true);
    document.documentElement.style.cursor = "crosshair";
    log("Inspect mode on");
  }

  stop(): void {
    this.clearHideTimer();
    if (!this.active) {
      this.overlay.destroy();
      return;
    }
    this.active = false;
    this.resetHover();
    document.removeEventListener("mousemove", this.onMove, true);
    document.removeEventListener("mouseover", this.onMove, true);
    document.removeEventListener("click", this.onClick, true);
    document.documentElement.style.cursor = "";
    this.overlay.destroy();
    log("Inspect mode off");
  }

  private onMove = (event: MouseEvent): void => {
    if (!this.active) {
      return;
    }
    if (
      isExtensionNode(event.target) ||
      this.overlay.isPointerInside() ||
      this.overlay.isPointerNear(event.clientX, event.clientY)
    ) {
      this.clearHideTimer();
      return;
    }
    const now = Date.now();
    if (now - this.lastMove < MOVE_THROTTLE_MS) {
      return;
    }
    this.lastMove = now;
    void this.inspect(event);
  };

  private onClick = (event: MouseEvent): void => {
    if (!this.active) {
      return;
    }
    if (this.overlay.contains(event.target) || this.overlay.isPointerInside()) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  private async inspect(event: MouseEvent): Promise<void> {
    try {
      const target = document.elementFromPoint(event.clientX, event.clientY);
      if (!target || isExtensionNode(target) || this.overlay.isPointerInside()) {
        this.clearHideTimer();
        return;
      }

      if (this.lastElement && this.lastElement.contains(target) && this.overlay.isVisible()) {
        this.clearHideTimer();
        return;
      }

      const resolved = resolveHoveredValue(target);
      if (!resolved) {
        this.scheduleHide();
        return;
      }

      const lookupKey = `${resolved.value.primaryKey}|${resolved.value.rawText}`;
      if (lookupKey === this.lastKey && this.overlay.isVisible()) {
        this.clearHideTimer();
        return;
      }

      log("UI value detected:", resolved.value.primaryKey);
      const matches = await this.lookup(resolved.value.lookupKeys, resolved.value.primaryKey);
      this.lastKey = lookupKey;
      this.lastElement = resolved.element;
      this.clearHideTimer();
      if (matches.length === 0) {
        this.overlay.hideCard();
        return;
      }
      this.overlay.show(matches, resolved.element.getBoundingClientRect(), lookupKey);
    } catch (error) {
      if (isInvalidatedError(error)) {
        this.stop();
        return;
      }
      logError("Inspect failed", error);
    }
  }

  private scheduleHide(): void {
    if (this.hideTimer != null || !this.overlay.isVisible()) {
      if (!this.overlay.isVisible()) {
        this.resetHover();
      }
      return;
    }
    this.hideTimer = window.setTimeout(() => {
      this.hideTimer = null;
      if (this.overlay.isPointerInside()) {
        return;
      }
      this.overlay.hideCard();
      this.resetHover();
    }, HIDE_DELAY_MS);
  }

  private clearHideTimer(): void {
    if (this.hideTimer != null) {
      window.clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }

  private resetHover(): void {
    this.lastKey = "";
    this.lastElement = null;
  }

  private lookup(keys: string[], primaryKey: string): Promise<ValueMatch[]> {
    return new Promise((resolve) => {
      if (!isExtensionContextValid()) {
        this.stop();
        resolve([]);
        return;
      }
      try {
        chrome.runtime.sendMessage(
          {
            type: MessageType.VALUE_LOOKUP_REQUEST,
            payload: {
              tabId: this.tabId ?? undefined,
              keys,
              primaryKey,
              pageUrl: location.href,
            },
          },
          (response: { payload?: LookupResult } | undefined) => {
            if (chrome.runtime.lastError) {
              resolve([]);
              return;
            }
            resolve(response?.payload?.matches ?? []);
          },
        );
      } catch {
        resolve([]);
      }
    });
  }

  private select(match: ValueMatch): void {
    if (!isExtensionContextValid()) {
      this.stop();
      return;
    }
    try {
      chrome.runtime.sendMessage({
        type: MessageType.SELECT_API_SOURCE,
        payload: {
          tabId: this.tabId,
          requestId: match.requestId,
          jsonPath: match.jsonPath,
        },
      });
    } catch (error) {
      if (isInvalidatedError(error)) {
        this.stop();
        return;
      }
      logError("Select source failed", error);
    }
  }
}
