import { HOST_ID } from "./value-parser";
import type { ValueMatch } from "../shared/types";

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
    });
    this.card?.addEventListener("pointerleave", () => {
      this.pointerInside = false;
    });
    document.documentElement.appendChild(host);
  }

  setInspecting(active: boolean): void {
    const banner = this.shadow?.querySelector(".banner");
    if (!(banner instanceof HTMLElement)) {
      return;
    }
    banner.hidden = !active;
    banner.textContent = active
      ? "ValueTrace inspect mode — hover a number, then click the URL in the popup."
      : "";
  }

  isVisible(): boolean {
    return Boolean(this.card && !this.card.hidden);
  }

  isPointerInside(): boolean {
    return this.pointerInside;
  }

  isPointerNear(clientX: number, clientY: number, pad = 28): boolean {
    if (!this.card || this.card.hidden) {
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

  show(matches: ValueMatch[], anchor: DOMRect, key: string): void {
    if (!this.card || !this.shadow) {
      return;
    }
    if (this.pinnedKey === key && !this.card.hidden) {
      return;
    }

    this.pinnedKey = key;
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
    hint.textContent = "Click a URL to open the request and jump to the field.";
    this.card.appendChild(hint);

    for (const match of matches) {
      this.card.appendChild(this.renderRow(match));
    }

    this.placeNear(anchor);
  }

  hideCard(): void {
    if (this.card) {
      this.card.hidden = true;
      this.card.replaceChildren();
    }
    this.pinnedKey = "";
    this.pointerInside = false;
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

  private renderRow(match: ValueMatch): HTMLDivElement {
    const row = document.createElement("div");
    row.className = "row";

    const api = document.createElement("button");
    api.type = "button";
    api.className = "api";
    api.textContent = `${match.method} ${match.displayUrl}`;
    api.title = "Open this request and highlight the matching field";
    api.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.onSelect?.({ match });
    });

    const path = document.createElement("button");
    path.type = "button";
    path.className = "path";
    path.textContent = match.jsonPath;
    path.title = "Highlight this field in the response";
    path.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.onSelect?.({ match });
    });

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `${match.rawValue} · ${match.matchType === "exact" ? "Exact" : "Normalized"}`;

    row.append(api, path, meta);
    return row;
  }

  private placeNear(anchor: DOMRect): void {
    if (!this.card) {
      return;
    }
    const width = 320;
    const height = this.card.getBoundingClientRect().height || 160;
    let x = anchor.left;
    let y = anchor.bottom + 6;
    if (y + height > window.innerHeight - 8) {
      y = Math.max(8, anchor.top - height - 6);
    }
    if (x + width > window.innerWidth - 8) {
      x = Math.max(8, window.innerWidth - width - 8);
    }
    if (x < 8) {
      x = 8;
    }
    this.card.style.left = `${Math.round(x)}px`;
    this.card.style.top = `${Math.round(y)}px`;
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
  .api,
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
  }
  .api {
    color: #8ab4f8;
    text-decoration: underline;
    word-break: break-all;
  }
  .api:hover,
  .path:hover {
    color: #c2d7ff;
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
