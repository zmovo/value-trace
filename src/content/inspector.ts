import { isExtensionContextValid, isInvalidatedError, markExtensionContextDead } from "../shared/extension-context";
import { log, logError } from "../shared/logger";
import { toCurl } from "../shared/exchange";
import { MessageType } from "../shared/message";
import type { LookupResult, UiHint, ValueMatch } from "../shared/types";
import { Overlay } from "./overlay";
import { highlightBounds, isExtensionNode, isOnResolvedValue, resolveHoveredValue } from "./value-parser";

type ResolvedHover = NonNullable<ReturnType<typeof resolveHoveredValue>>;

const MOVE_THROTTLE_MS = 32;

export class Inspector {
  private readonly overlay = new Overlay();
  private active = false;
  private lastKey = "";
  private lastMove = 0;
  private tabId: number | null = null;
  private keepAlive: chrome.runtime.Port | null = null;
  private matchCache = new Map<string, ValueMatch[]>();
  private wantedKey = "";
  private inflightKey = "";
  private inflight: Promise<ValueMatch[]> | null = null;
  private lastPoint = "";
  private lastResolved: ResolvedHover | null = null;
  private overValue = false;
  private cursorStyle: HTMLStyleElement | null = null;
  private suppressPageClick = false;

  start(tabId?: number): boolean {
    if (!isExtensionContextValid()) {
      return false;
    }
    if (this.active) {
      this.overlay.setInspecting(true);
      if (this.overlay.isInspecting()) {
        return true;
      }
      this.active = false;
    }
    this.tabId = tabId ?? this.tabId;
    this.active = true;
    this.resetPin();
    this.overlay.mount(
      (detail) => this.select(detail.match),
      () => this.requestStop(),
      (match) => this.downloadExchange(match),
      (match) => this.curlFor(match),
      () => this.dismiss(),
    );
    this.overlay.setInspecting(true);
    if (!this.overlay.isInspecting()) {
      this.stop();
      return false;
    }
    try {
      this.keepAlive = chrome.runtime.connect({ name: "inspect" });
    } catch (error) {
      this.keepAlive = null;
      if (isInvalidatedError(error)) {
        markExtensionContextDead();
        this.stop();
        return false;
      }
    }
    document.addEventListener("mousemove", this.onMove, true);
    document.addEventListener("pointerdown", this.onPointerDown, true);
    document.addEventListener("mousedown", this.onSuppressPageClick, true);
    document.addEventListener("pointerup", this.onSuppressPageClick, true);
    document.addEventListener("click", this.onSuppressPageClick, true);
    document.addEventListener("keydown", this.onKeyDown, true);
    this.installCursorStyle();
    this.setCursor(false);
    log("Inspect mode on");
    return true;
  }

  stop(): void {
    if (!this.active) {
      this.clearCursor();
      this.cursorStyle?.remove();
      this.cursorStyle = null;
      this.overlay.destroy();
      return;
    }
    this.active = false;
    this.resetPin();
    try {
      this.keepAlive?.disconnect();
    } catch (error) {
      if (isInvalidatedError(error)) {
        markExtensionContextDead();
      }
    }
    this.keepAlive = null;
    this.matchCache.clear();
    document.removeEventListener("mousemove", this.onMove, true);
    document.removeEventListener("pointerdown", this.onPointerDown, true);
    document.removeEventListener("mousedown", this.onSuppressPageClick, true);
    document.removeEventListener("pointerup", this.onSuppressPageClick, true);
    document.removeEventListener("click", this.onSuppressPageClick, true);
    document.removeEventListener("keydown", this.onKeyDown, true);
    this.suppressPageClick = false;
    this.clearCursor();
    this.cursorStyle?.remove();
    this.cursorStyle = null;
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

  private onMove = (event: MouseEvent): void => {
    if (!this.active) {
      return;
    }
    if (this.overlay.isPointerInside()) {
      this.overlay.highlight(null);
      this.setCursor(false, true);
      return;
    }
    const now = Date.now();
    if (now - this.lastMove < MOVE_THROTTLE_MS) {
      return;
    }
    this.lastMove = now;
    const target = document.elementFromPoint(event.clientX, event.clientY);
    if (!target || isExtensionNode(target)) {
      this.overlay.highlight(null);
      this.setCursor(false);
      return;
    }
    const resolved = this.resolveAt(target, event.clientX, event.clientY);
    if (!resolved || !isOnResolvedValue(resolved.element, event.clientX, event.clientY)) {
      this.overlay.highlight(null);
      this.setCursor(false);
      return;
    }
    this.overlay.highlight(highlightBounds(resolved.element));
    this.setCursor(true);
  };

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.active || event.button !== 0) {
      return;
    }
    if (this.overlay.isPointerInside() || isExtensionNode(event.target)) {
      return;
    }
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const resolved =
      target && !isExtensionNode(target)
        ? this.resolveAt(target, event.clientX, event.clientY)
        : null;
    if (!resolved || !isOnResolvedValue(resolved.element, event.clientX, event.clientY)) {
      this.suppressPageClick = false;
      if (this.overlay.isVisible()) {
        this.dismiss();
      }
      return;
    }
    this.suppressPageClick = true;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    void this.inspectClick(event);
  };

  private onSuppressPageClick = (event: Event): void => {
    if (!this.suppressPageClick) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (event.type === "click" || event.type === "pointerup") {
      window.setTimeout(() => {
        this.suppressPageClick = false;
      }, 50);
    }
  };

  private async inspectClick(event: PointerEvent): Promise<void> {
    try {
      const target = document.elementFromPoint(event.clientX, event.clientY);
      if (!target || isExtensionNode(target)) {
        return;
      }

      const resolved = this.resolveAt(target, event.clientX, event.clientY);
      if (!resolved || !isOnResolvedValue(resolved.element, event.clientX, event.clientY)) {
        this.dismiss();
        return;
      }
      this.overlay.highlight(highlightBounds(resolved.element));

      const hints = resolved.hints;
      const lookupKey = `${resolved.value.primaryKey}|${resolved.value.rawText}`;
      if (lookupKey === this.lastKey && this.overlay.isVisible()) {
        return;
      }

      this.wantedKey = lookupKey;
      this.overlay.hideCard();
      this.lastKey = "";
      log("UI value selected:", resolved.value.primaryKey, hints.labels[0] ?? "");
      const matches = await this.lookup(resolved.value.lookupKeys, resolved.value.primaryKey, hints);
      if (this.wantedKey !== lookupKey) {
        return;
      }
      this.lastKey = lookupKey;
      if (matches.length === 0) {
        this.resetPin();
        this.overlay.notify(
          "Not recorded yet. Refresh the page, then click this number again.",
          "Refresh the page",
        );
        return;
      }
      const avoid = toBounds(resolved.element.getBoundingClientRect());
      this.overlay.unlock();
      this.overlay.show(matches, lookupKey, event.clientX, event.clientY, hints.labels[0], avoid);
      this.overlay.lock();
    } catch (error) {
      if (isInvalidatedError(error)) {
        this.stop();
        return;
      }
      logError("Inspect failed", error);
    }
  }

  private dismiss(): void {
    this.overlay.hideCard();
    this.resetPin();
  }

  private resetPin(): void {
    this.lastKey = "";
    this.wantedKey = "";
    this.lastPoint = "";
    this.lastResolved = null;
  }

  private resolveAt(target: Element, clientX: number, clientY: number): ResolvedHover | null {
    const point = `${target}|${clientX | 0}|${clientY | 0}`;
    if (this.lastPoint === point) {
      return this.lastResolved;
    }
    const resolved = resolveHoveredValue(target, clientX, clientY);
    this.lastPoint = point;
    this.lastResolved = resolved;
    return resolved;
  }

  private installCursorStyle(): void {
    if (this.cursorStyle) {
      return;
    }
    const style = document.createElement("style");
    style.setAttribute("data-valuetrace", "cursor");
    style.textContent =
      "html.valuetrace-inspect,html.valuetrace-inspect *:not(#valuetrace-root){cursor:inherit!important}";
    document.documentElement.classList.add("valuetrace-inspect");
    document.documentElement.appendChild(style);
    this.cursorStyle = style;
  }

  private setCursor(overValue: boolean, onOverlay = false): void {
    if (onOverlay) {
      if (this.overValue) {
        this.overValue = false;
        document.documentElement.style.cursor = "";
      }
      return;
    }
    if (this.overValue === overValue && document.documentElement.style.cursor) {
      return;
    }
    this.overValue = overValue;
    document.documentElement.style.cursor = overValue ? "pointer" : "default";
  }

  private clearCursor(): void {
    this.overValue = false;
    document.documentElement.style.cursor = "";
    document.documentElement.classList.remove("valuetrace-inspect");
  }

  private lookup(keys: string[], primaryKey: string, hints: UiHint): Promise<ValueMatch[]> {
    const cacheKey = `${primaryKey}|${keys.join(",")}|${hints.tokens.join(",")}`;
    const cached = this.matchCache.get(cacheKey);
    if (cached) {
      return Promise.resolve(cached);
    }
    if (this.inflight && this.inflightKey === cacheKey) {
      return this.inflight;
    }
    this.inflightKey = cacheKey;
    this.inflight = new Promise((resolve) => {
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
            this.inflight = null;
            this.inflightKey = "";
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
        this.inflight = null;
        this.inflightKey = "";
        resolve([]);
      }
    });
    return this.inflight;
  }

  private requestStop(): void {
    if (!isExtensionContextValid()) {
      this.stop();
      return;
    }
    try {
      chrome.runtime.sendMessage({
        type: MessageType.INSPECT_MODE_STOP,
        payload: { tabId: this.tabId },
      });
    } catch {
      this.stop();
    }
  }

  private curlFor(match: ValueMatch): Promise<string | null> {
    return new Promise((resolve) => {
      if (!isExtensionContextValid()) {
        this.stop();
        resolve(null);
        return;
      }
      try {
        chrome.runtime.sendMessage(
          {
            type: MessageType.GET_REQUEST_SNAPSHOT,
            payload: {
              tabId: this.tabId ?? undefined,
              requestId: match.requestId,
            },
          },
          (response: { ok?: boolean; url?: string; method?: string; requestBody?: string } | undefined) => {
            if (chrome.runtime.lastError || !response?.ok || !response.url || !response.method) {
              resolve(null);
              return;
            }
            resolve(toCurl(response.method, response.url, response.requestBody ?? ""));
          },
        );
      } catch (error) {
        if (isInvalidatedError(error)) {
          this.stop();
        }
        resolve(null);
      }
    });
  }

  private downloadExchange(match: ValueMatch): Promise<boolean> {
    return new Promise((resolve) => {
      if (!isExtensionContextValid()) {
        this.stop();
        resolve(false);
        return;
      }
      try {
        chrome.runtime.sendMessage(
          {
            type: MessageType.GET_REQUEST_EXCHANGE,
            payload: {
              tabId: this.tabId ?? undefined,
              requestId: match.requestId,
            },
          },
          (response: { ok?: boolean; filename?: string; text?: string } | undefined) => {
            if (chrome.runtime.lastError) {
              resolve(false);
              return;
            }
            if (response?.ok) {
              resolve(true);
              return;
            }
            if (response?.filename && typeof response.text === "string") {
              resolve(saveTextFile(response.filename, response.text));
              return;
            }
            resolve(false);
          },
        );
      } catch (error) {
        if (isInvalidatedError(error)) {
          this.stop();
        }
        resolve(false);
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

function saveTextFile(filename: string, text: string): boolean {
  try {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    anchor.style.cssText = "position:fixed;left:-9999px;top:0";
    document.documentElement.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    return true;
  } catch {
    return false;
  }
}

function toBounds(rect: DOMRect): { left: number; top: number; right: number; bottom: number } {
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
}
