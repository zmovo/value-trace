import { isExtensionContextValid, isInvalidatedError } from "../shared/extension-context";
import { log, logError } from "../shared/logger";
import { MessageType } from "../shared/message";
import type { LookupResult, UiHint, ValueMatch } from "../shared/types";
import { Overlay } from "./overlay";
import { isExtensionNode, resolveHoveredValue, stickyHoverElement } from "./value-parser";

const MOVE_THROTTLE_MS = 32;
const HIDE_DELAY_MS = 450;
const PIN_AFTER_MS = 160;
const VALUE_PAD = 10;

export class Inspector {
  private readonly overlay = new Overlay();
  private active = false;
  private lastKey = "";
  private lastMove = 0;
  private hideTimer: number | null = null;
  private pinTimer: number | null = null;
  private tabId: number | null = null;
  private hoverBounds: { left: number; top: number; right: number; bottom: number } | null = null;
  private keepAlive: chrome.runtime.Port | null = null;
  private matchCache = new Map<string, ValueMatch[]>();
  private inspectSeq = 0;

  start(tabId?: number): void {
    if (this.active) {
      return;
    }
    this.tabId = tabId ?? this.tabId;
    this.active = true;
    this.resetHover();
    this.overlay.mount((detail) => this.select(detail.match));
    this.overlay.setInspecting(true);
    try {
      this.keepAlive = isExtensionContextValid() ? chrome.runtime.connect({ name: "inspect" }) : null;
    } catch {
      this.keepAlive = null;
    }
    document.addEventListener("mousemove", this.onMove, true);
    document.addEventListener("keydown", this.onKeyDown, true);
    document.documentElement.addEventListener("mouseleave", this.onPageLeave);
    document.documentElement.style.cursor = "crosshair";
    log("Inspect mode on");
  }

  stop(): void {
    this.clearHideTimer();
    this.clearPinTimer();
    if (!this.active) {
      this.overlay.destroy();
      return;
    }
    this.active = false;
    this.resetHover();
    this.keepAlive?.disconnect();
    this.keepAlive = null;
    this.matchCache.clear();
    document.removeEventListener("mousemove", this.onMove, true);
    document.removeEventListener("keydown", this.onKeyDown, true);
    document.documentElement.removeEventListener("mouseleave", this.onPageLeave);
    document.documentElement.style.cursor = "";
    this.overlay.destroy();
    log("Inspect mode off");
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || !this.overlay.isVisible()) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.dismiss();
  };

  private onPageLeave = (): void => {
    if (this.overlay.isPointerInside()) {
      return;
    }
    this.dismiss();
  };

  private onMove = (event: MouseEvent): void => {
    if (!this.active) {
      return;
    }
    if (this.overlay.isPointerInside() || this.isOverSafeZone(event.clientX, event.clientY)) {
      this.clearHideTimer();
      if (this.overlay.isPointerInside()) {
        this.clearPinTimer();
        this.overlay.lock();
        return;
      }
    } else if (this.overlay.isVisible()) {
      this.scheduleHide();
    }
    const now = Date.now();
    if (now - this.lastMove < MOVE_THROTTLE_MS) {
      return;
    }
    this.lastMove = now;
    void this.inspect(event);
  };

  private async inspect(event: MouseEvent): Promise<void> {
    const seq = (this.inspectSeq += 1);
    try {
      const target = document.elementFromPoint(event.clientX, event.clientY);
      if (this.overlay.isPointerInside()) {
        this.clearHideTimer();
        return;
      }
      if (!target) {
        if (!this.isOverSafeZone(event.clientX, event.clientY)) {
          this.scheduleHide();
        }
        return;
      }
      if (isExtensionNode(target)) {
        this.clearHideTimer();
        return;
      }

      const resolved = resolveHoveredValue(target, event.clientX, event.clientY);
      if (!resolved) {
        if (!this.isOverSafeZone(event.clientX, event.clientY)) {
          this.scheduleHide();
        } else {
          this.clearHideTimer();
        }
        return;
      }

      const hints = resolved.hints;
      const lookupKey = `${resolved.value.primaryKey}|${resolved.value.rawText}|${hints.tokens.slice(0, 8).join(",")}`;
      const overValue = this.isOverHoveredValue(event.clientX, event.clientY);
      if (lookupKey === this.lastKey && this.overlay.isVisible() && (overValue || this.isOverSafeZone(event.clientX, event.clientY))) {
        this.clearHideTimer();
        this.rememberHover(resolved.element);
        this.overlay.followCursor(event.clientX, event.clientY);
        this.armPin();
        return;
      }
      if (lookupKey === this.lastKey && this.overlay.isVisible() && !this.isOverSafeZone(event.clientX, event.clientY)) {
        this.scheduleHide();
        return;
      }

      log("UI value detected:", resolved.value.primaryKey, hints.labels[0] ?? "");
      const matches = await this.lookup(resolved.value.lookupKeys, resolved.value.primaryKey, hints);
      if (seq !== this.inspectSeq) {
        return;
      }
      this.lastKey = lookupKey;
      this.rememberHover(resolved.element);
      this.clearHideTimer();
      if (matches.length === 0) {
        this.overlay.hideCard();
        this.resetHover();
        return;
      }
      this.overlay.unlock();
      this.overlay.show(matches, lookupKey, event.clientX, event.clientY, hints.labels[0], this.hoverBounds);
      this.armPin();
    } catch (error) {
      if (isInvalidatedError(error)) {
        this.stop();
        return;
      }
      logError("Inspect failed", error);
    }
  }

  private armPin(): void {
    this.clearPinTimer();
    this.pinTimer = window.setTimeout(() => {
      this.pinTimer = null;
      this.overlay.lock();
    }, PIN_AFTER_MS);
  }

  private scheduleHide(): void {
    this.clearPinTimer();
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
      this.dismiss();
    }, HIDE_DELAY_MS);
  }

  private dismiss(): void {
    this.clearHideTimer();
    this.clearPinTimer();
    this.overlay.hideCard();
    this.resetHover();
  }

  private clearHideTimer(): void {
    if (this.hideTimer != null) {
      window.clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }

  private clearPinTimer(): void {
    if (this.pinTimer != null) {
      window.clearTimeout(this.pinTimer);
      this.pinTimer = null;
    }
  }

  private resetHover(): void {
    this.lastKey = "";
    this.hoverBounds = null;
  }

  private rememberHover(element: Element): void {
    const rect = stickyHoverElement(element).getBoundingClientRect();
    this.hoverBounds = {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
    };
  }

  private isOverHoveredValue(clientX: number, clientY: number): boolean {
    return pointInBounds(this.hoverBounds, clientX, clientY, VALUE_PAD);
  }

  private isOverSafeZone(clientX: number, clientY: number): boolean {
    if (this.isOverHoveredValue(clientX, clientY)) {
      return true;
    }
    if (this.overlay.containsPoint(clientX, clientY, 24)) {
      return true;
    }
    const card = this.overlay.getCardRect();
    const hover = this.hoverBounds;
    if (!card || !hover || !this.overlay.isVisible()) {
      return false;
    }
    const left = Math.min(hover.left, card.left);
    const right = Math.max(hover.right, card.right);
    const top = Math.min(hover.top, card.top);
    const bottom = Math.max(hover.bottom, card.bottom);
    if (right - left > 520 || bottom - top > 360) {
      return false;
    }
    return pointInBounds({ left, top, right, bottom }, clientX, clientY, 0);
  }

  private lookup(keys: string[], primaryKey: string, hints: UiHint): Promise<ValueMatch[]> {
    const cacheKey = `${primaryKey}|${keys.join(",")}|${hints.tokens.join(",")}`;
    const cached = this.matchCache.get(cacheKey);
    if (cached) {
      return Promise.resolve(cached);
    }
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
              hints,
            },
          },
          (response: { payload?: LookupResult } | undefined) => {
            if (chrome.runtime.lastError) {
              resolve([]);
              return;
            }
            const matches = response?.payload?.matches ?? [];
            if (matches.length > 0) {
              if (this.matchCache.size > 80) {
                this.matchCache.clear();
              }
              this.matchCache.set(cacheKey, matches);
            }
            resolve(matches);
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

function pointInBounds(
  bounds: { left: number; top: number; right: number; bottom: number } | null,
  clientX: number,
  clientY: number,
  pad: number,
): boolean {
  if (!bounds) {
    return false;
  }
  return (
    clientX >= bounds.left - pad &&
    clientX <= bounds.right + pad &&
    clientY >= bounds.top - pad &&
    clientY <= bounds.bottom + pad
  );
}
