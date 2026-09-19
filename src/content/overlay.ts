import { apiNameSuffix } from "../shared/url";
import type { ValueMatch } from "../shared/types";
import { HOST_ID } from "./value-parser";

export interface OverlayClickDetail {
  match: ValueMatch;
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
      ? "ValueTrace inspect mode — pause on a number to pin the popup, then click a URL."
      : "";
  }

  isVisible(): boolean {
    return Boolean(this.card && !this.card.hidden);
  }

  isLocked(): boolean {
    return this.locked;
  }

  isPointerInside(): boolean {
    return this.pointerInside;
  }

  isPointerNear(clientX: number, clientY: number, pad = 20): boolean {
    if (!this.card || this.card.hidden || !this.locked) {
      return false;
    }
    const rect = this.card.getBoundingClientRect();
    return (
      clientX >= rect.left - pad &&
      clientX <= rect.right + pad &&
      clientY >= rect.top - pad &&
      clientY <= rect.bottom + pad
    );
  }

  show(matches: ValueMatch[], key: string, clientX: number, clientY: number): void {
    if (!this.card || !this.shadow) {
      return;
    }
    if (this.pinnedKey === key && !this.card.hidden) {
      this.followCursor(clientX, clientY);
      return;
    }

    this.pinnedKey = key;
    this.locked = false;
    this.currentMatches = matches;
    this.card.hidden = false;
    this.card.replaceChildren();

    const title = document.createElement("div");
    title.className = "title";
    title.textContent = "API Source";
    this.card.appendChild(title);

    const count = document.createElement("div");
    count.className = "count";
    count.textContent = matches.length === 1 ? "1 match" : `${matches.length} matches`;
    this.card.appendChild(count);

    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = "复制接口名后可粘贴到 Network 搜索。";
    this.card.appendChild(hint);

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
    const row = document.createElement("div");
    row.className = "row";
    row.setAttribute("data-match-index", String(index));

    const head = document.createElement("div");
    head.className = "head";

    const api = document.createElement("button");
    api.type = "button";
    api.className = "api";
    api.setAttribute("data-match-index", String(index));
    api.textContent = `${match.method} ${match.displayUrl}`;
    api.title = "Open this request and highlight the matching field";

    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "copy";
    copy.setAttribute("data-copy-index", String(index));
    copy.textContent = "复制";
    copy.title = `复制 ${apiNameSuffix(match.url)}，到 Network 里搜索`;

    head.append(api, copy);

    const path = document.createElement("button");
    path.type = "button";
    path.className = "path";
    path.setAttribute("data-match-index", String(index));
    path.textContent = match.jsonPath;
    path.title = "Highlight this field in the response";

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `${match.rawValue} · ${match.matchType === "exact" ? "Exact" : "Normalized"}`;

    row.append(head, path, meta);
    return row;
  }

  private async copyApiName(match: ValueMatch, button: Element): Promise<void> {
    const name = apiNameSuffix(match.url);
    const ok = await writeClipboard(name);
    const label = button.textContent;
    button.textContent = ok ? "已复制" : "失败";
    window.setTimeout(() => {
      button.textContent = label;
    }, 1200);
  }

  private placeAtCursor(clientX: number, clientY: number): void {
    if (!this.card) {
      return;
    }
    const width = 320;
    const height = this.card.getBoundingClientRect().height || 160;
    let x = clientX + 16;
    let y = clientY + 18;
    if (x + width > window.innerWidth - 8) {
      x = Math.max(8, clientX - width - 12);
    }
    if (y + height > window.innerHeight - 8) {
      y = Math.max(8, clientY - height - 12);
    }
    if (x < 8) {
      x = 8;
    }
    this.card.style.left = `${Math.round(x)}px`;
    this.card.style.top = `${Math.round(y)}px`;
  }
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
    font: 12px/28px ui-sans-serif, system-ui, sans-serif;
    text-align: center;
    letter-spacing: 0.01em;
  }
  .card {
    position: fixed;
    z-index: 2147483647;
    width: 320px;
    max-height: 280px;
    overflow: auto;
    box-sizing: border-box;
    padding: 10px 10px 8px;
    border-radius: 10px;
    background: #202124;
    color: #e8eaed;
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35);
    border: 1px solid #3c4043;
    font: 12px/1.4 ui-sans-serif, system-ui, sans-serif;
    pointer-events: auto;
  }
  .title {
    font-weight: 700;
    font-size: 13px;
  }
  .count,
  .hint {
    color: #9aa0a6;
    margin: 2px 0 6px;
  }
  .hint {
    margin-bottom: 8px;
  }
  .row {
    display: block;
    width: 100%;
    box-sizing: border-box;
    margin: 0 0 6px;
    padding: 8px;
    border: 1px solid #3c4043;
    border-radius: 8px;
    background: #2b2c2f;
  }
  .row:hover {
    border-color: #8ab4f8;
  }
  .head {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }
  .copy {
    flex: none;
    margin-left: auto;
    border: 0;
    border-radius: 4px;
    padding: 2px 6px;
    background: #3c4043;
    color: #e8eaed;
    font: 11px/1.4 ui-sans-serif, system-ui, sans-serif;
    cursor: pointer;
  }
  .copy:hover {
    background: #5f6368;
  }
  .api,
  .path {
    display: block;
    padding: 0;
    border: 0;
    background: transparent;
    text-align: left;
    cursor: pointer;
    color: inherit;
    font: inherit;
  }
  .api {
    flex: 1;
    min-width: 0;
  }
  .head .api,
  .api {
    color: #8ab4f8;
    text-decoration: underline;
    word-break: break-all;
  }
  .api:hover,
  .path:hover,
  .pressed {
    color: #c2d7ff;
  }
  .pressed {
    text-decoration: none;
  }
  .path {
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    margin-top: 4px;
  }
  .meta {
    color: #9aa0a6;
    margin-top: 4px;
  }
</style>
`;
