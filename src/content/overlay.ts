import { apiNameSuffix } from "../shared/url";
import type { ValueMatch } from "../shared/types";
import { HOST_ID } from "./value-parser";

export interface OverlayClickDetail {
  match: ValueMatch;
}

const CARD_WIDTH = 400;

export interface OverlayAvoidRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export class Overlay {
  private host: HTMLDivElement | null = null;
  private shadow: ShadowRoot | null = null;
  private card: HTMLDivElement | null = null;
  private onSelect: ((detail: OverlayClickDetail) => void) | null = null;
  private pinnedKey = "";
  private pointerInside = false;
  private locked = false;
  private currentMatches: ValueMatch[] = [];
  private avoid: OverlayAvoidRect | null = null;

  mount(onSelect: (detail: OverlayClickDetail) => void): void {
    this.onSelect = onSelect;
    if (this.host) {
      return;
    }

    const host = document.createElement("div");
    host.id = HOST_ID;
    host.setAttribute("data-valuetrace", "root");
    host.style.cssText =
      "all:initial;position:fixed;z-index:2147483646;top:0;left:0;width:0;height:0;pointer-events:none;";
    const shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = `${styles}<div class="banner"></div><div class="card" hidden></div>`;

    this.host = host;
    this.shadow = shadow;
    this.card = shadow.querySelector(".card");
    this.card?.addEventListener("pointerenter", () => {
      this.pointerInside = true;
      this.locked = true;
    });
    this.card?.addEventListener("pointerleave", () => {
      this.pointerInside = false;
    });
    this.card?.addEventListener(
      "pointerdown",
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        const node = event.target instanceof Node ? event.target : null;
        const from = node instanceof Element ? node : node?.parentElement;
        const copyBtn = from?.closest("[data-copy-index]");
        if (copyBtn) {
          const index = Number(copyBtn.getAttribute("data-copy-index"));
          const match = this.currentMatches[index];
          if (match) {
            void this.copyApiName(match, copyBtn);
          }
          return;
        }
        const target = from?.closest("[data-match-index]") ?? null;
        if (!target) {
          return;
        }
        const index = Number(target.getAttribute("data-match-index"));
        const match = this.currentMatches[index];
        if (!match) {
          return;
        }
        target.classList.add("pressed");
        window.setTimeout(() => target.classList.remove("pressed"), 180);
        this.onSelect?.({ match });
      },
      true,
    );
    document.documentElement.appendChild(host);
  }

  setInspecting(active: boolean): void {
    const banner = this.shadow?.querySelector(".banner");
    if (!(banner instanceof HTMLElement)) {
      return;
    }
    banner.hidden = !active;
    banner.textContent = active
      ? "ValueTrace inspect mode — hover a number, then move onto the popup to copy."
      : "";
  }

  isVisible(): boolean {
    return Boolean(this.card && !this.card.hidden);
  }

  isPointerInside(): boolean {
    return this.pointerInside;
  }

  containsPoint(clientX: number, clientY: number, pad = 16): boolean {
    const rect = this.getCardRect();
    if (!rect) {
      return false;
    }
    return (
      clientX >= rect.left - pad &&
      clientX <= rect.right + pad &&
      clientY >= rect.top - pad &&
      clientY <= rect.bottom + pad
    );
  }

  getCardRect(): OverlayAvoidRect | null {
    if (!this.card || this.card.hidden) {
      return null;
    }
    const rect = this.card.getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
  }

  show(
    matches: ValueMatch[],
    key: string,
    clientX: number,
    clientY: number,
    uiLabel?: string,
    avoid?: OverlayAvoidRect | null,
  ): void {
    if (!this.card || !this.shadow) {
      return;
    }
    if (this.pinnedKey === key && !this.card.hidden) {
      this.followCursor(clientX, clientY);
      return;
    }

    this.pinnedKey = key;
    this.locked = false;
    this.avoid = avoid ?? null;
    this.currentMatches = matches;
    this.card.hidden = false;
    this.card.replaceChildren();

    const header = document.createElement("div");
    header.className = "header";
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = "API Source";
    const count = document.createElement("div");
    count.className = "count";
    count.textContent = matches.length === 1 ? "1 match" : `${matches.length} matches`;
    header.append(title, count);
    this.card.appendChild(header);
    if (uiLabel) {
      const via = document.createElement("div");
      via.className = "via";
      via.textContent = uiLabel;
      this.card.appendChild(via);
    }

    matches.forEach((match, index) => {
      this.card?.appendChild(this.renderRow(match, index));
    });

    this.placeAtCursor(clientX, clientY);
  }

  followCursor(clientX: number, clientY: number): void {
    if (this.locked || this.pointerInside || !this.card || this.card.hidden) {
      return;
    }
    this.placeAtCursor(clientX, clientY);
  }

  lock(): void {
    this.locked = true;
  }

  unlock(): void {
    this.locked = false;
  }

  hideCard(): void {
    if (this.card) {
      this.card.hidden = true;
      this.card.replaceChildren();
    }
    this.pinnedKey = "";
    this.pointerInside = false;
    this.locked = false;
    this.currentMatches = [];
    this.avoid = null;
  }

  contains(target: EventTarget | null): boolean {
    return Boolean(this.host && target instanceof Node && this.host.contains(target));
  }

  destroy(): void {
    this.hideCard();
    this.host?.remove();
    this.host = null;
    this.shadow = null;
    this.card = null;
    this.onSelect = null;
  }

  private renderRow(match: ValueMatch, index: number): HTMLDivElement {
    const suffix = apiNameSuffix(match.url);
    const row = document.createElement("div");
    row.className = "row";

    const method = document.createElement("span");
    method.className = "method";
    method.textContent = match.method;

    if (match.likely) {
      const likely = document.createElement("span");
      likely.className = "likely";
      likely.textContent = "likely";
      row.append(method, likely);
    } else {
      row.appendChild(method);
    }

    const url = document.createElement("button");
    url.type = "button";
    url.className = "url";
    url.setAttribute("data-match-index", String(index));
    url.textContent = match.displayUrl;
    url.title = match.url;

    const path = document.createElement("button");
    path.type = "button";
    path.className = "path";
    path.setAttribute("data-match-index", String(index));
    path.textContent = match.jsonPath;

    const footer = document.createElement("div");
    footer.className = "footer";

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `${match.rawValue} · ${match.matchType === "exact" ? "Exact" : "Normalized"}`;

    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "copy";
    copy.setAttribute("data-copy-index", String(index));
    copy.textContent = "Copy";
    copy.title = `Copy ${suffix}`;

    const copyHint = document.createElement("div");
    copyHint.className = "copy-hint";
    copyHint.textContent = suffix;

    footer.append(meta, copy);
    row.append(url, path, copyHint, footer);
    return row;
  }

  private async copyApiName(match: ValueMatch, button: Element): Promise<void> {
    const name = apiNameSuffix(match.url);
    const ok = await writeClipboard(name);
    const label = button.textContent;
    button.textContent = ok ? "Copied" : "Failed";
    window.setTimeout(() => {
      button.textContent = label;
    }, 1200);
  }

  private placeAtCursor(clientX: number, clientY: number): void {
    if (!this.card) {
      return;
    }
    const height = this.card.getBoundingClientRect().height || 180;
    let x = clientX + 18;
    let y = clientY + 20;
    if (this.avoid) {
      x = this.avoid.right + 14;
      y = this.avoid.top;
      if (x + CARD_WIDTH > window.innerWidth - 8) {
        x = Math.max(8, this.avoid.left - CARD_WIDTH - 14);
      }
      if (overlaps(x, y, CARD_WIDTH, height, this.avoid)) {
        y = this.avoid.bottom + 12;
      }
    }
    if (x + CARD_WIDTH > window.innerWidth - 8) {
      x = Math.max(8, clientX - CARD_WIDTH - 12);
    }
    if (y + height > window.innerHeight - 8) {
      y = Math.max(8, clientY - height - 12);
    }
    if (x < 8) {
      x = 8;
    }
    if (y < 8) {
      y = 8;
    }
    this.card.style.left = `${Math.round(x)}px`;
    this.card.style.top = `${Math.round(y)}px`;
  }
}

function overlaps(
  x: number,
  y: number,
  width: number,
  height: number,
  avoid: OverlayAvoidRect,
): boolean {
  return x < avoid.right && x + width > avoid.left && y < avoid.bottom && y + height > avoid.top;
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const input = document.createElement("textarea");
    input.value = text;
    input.setAttribute("readonly", "readonly");
    input.style.cssText = "position:fixed;left:-9999px;top:0";
    document.documentElement.appendChild(input);
    input.select();
    const ok = document.execCommand("copy");
    input.remove();
    return ok;
  }
}

const styles = `
<style>
  :host {
    all: initial;
    pointer-events: none;
  }
  .banner {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 2147483646;
    background: #1a73e8;
    color: #fff;
    font: 12px/28px Arial, Helvetica, sans-serif;
    text-align: center;
  }
  .card {
    position: fixed;
    z-index: 2147483647;
    width: ${CARD_WIDTH}px;
    max-width: calc(100vw - 16px);
    max-height: min(300px, calc(100vh - 16px));
    overflow: auto;
    box-sizing: border-box;
    padding: 10px;
    border-radius: 12px;
    background: #1f1f1f;
    color: #ececec;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45);
    border: 1px solid #3c4043;
    font: 12px/1.45 Arial, Helvetica, sans-serif;
    pointer-events: auto;
  }
  .header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
  }
  .title {
    font-weight: 700;
    font-size: 13px;
  }
  .count {
    color: #9aa0a6;
  }
  .via {
    color: #9aa0a6;
    margin: -2px 0 10px;
  }
  .likely {
    display: inline-block;
    margin: 0 0 6px 6px;
    padding: 1px 6px;
    border-radius: 4px;
    background: #174ea6;
    color: #d2e3fc;
    font-size: 11px;
    font-weight: 700;
  }
  .row {
    box-sizing: border-box;
    margin: 0 0 6px;
    padding: 8px;
    border: 1px solid #3c4043;
    border-radius: 10px;
    background: #2b2c2f;
  }
  .row:hover {
    border-color: #8ab4f8;
  }
  .method {
    display: inline-block;
    margin-bottom: 6px;
    padding: 1px 6px;
    border-radius: 4px;
    background: #0d652d;
    color: #ceead6;
    font-size: 11px;
    font-weight: 700;
  }
  .url,
  .path {
    display: block;
    width: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    text-align: left;
    cursor: pointer;
    color: inherit;
    font: inherit;
    white-space: normal;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  .url {
    color: #8ab4f8;
    font-family: Consolas, "Courier New", monospace;
    font-size: 12px;
  }
  .path {
    margin-top: 6px;
    color: #e8eaed;
    font-family: Consolas, "Courier New", monospace;
  }
  .copy-hint {
    margin-top: 6px;
    color: #9aa0a6;
    font-family: Consolas, "Courier New", monospace;
    overflow-wrap: anywhere;
  }
  .footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-top: 8px;
  }
  .meta {
    color: #9aa0a6;
  }
  .copy {
    flex: none;
    border: 0;
    border-radius: 6px;
    padding: 4px 8px;
    background: #8ab4f8;
    color: #202124;
    font: 11px/1.3 Arial, Helvetica, sans-serif;
    font-weight: 700;
    cursor: pointer;
  }
  .copy:hover,
  .url:hover,
  .path:hover,
  .pressed {
    filter: brightness(1.08);
  }
</style>
`;
