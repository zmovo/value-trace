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
  private onStopInspect: (() => void) | null = null;
  private pinnedKey = "";
  private pointerInside = false;
  private locked = false;
  private currentMatches: ValueMatch[] = [];
  private avoid: OverlayAvoidRect | null = null;
  private cardRect: OverlayAvoidRect | null = null;
  private hit: HTMLDivElement | null = null;

  mount(onSelect: (detail: OverlayClickDetail) => void, onStopInspect?: () => void): void {
    this.onSelect = onSelect;
    this.onStopInspect = onStopInspect ?? null;
    if (this.host) {
      return;
    }

    const host = document.createElement("div");
    host.id = HOST_ID;
    host.setAttribute("data-valuetrace", "root");
    host.style.cssText =
      "all:initial;position:fixed;z-index:2147483646;top:0;left:0;width:0;height:0;pointer-events:none;";
    const shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = `${styles}<div class="banner" hidden><span class="banner-text"></span><button type="button" class="banner-close" aria-label="Stop inspect">×</button></div><div class="hit" hidden></div><div class="card" hidden></div>`;

    this.host = host;
    this.shadow = shadow;
    this.card = shadow.querySelector(".card");
    this.hit = shadow.querySelector(".hit");
    this.shadow.querySelector(".banner-close")?.addEventListener(
      "pointerdown",
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.onStopInspect?.();
      },
      true,
    );
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
    const label = this.shadow?.querySelector(".banner-text");
    if (!(banner instanceof HTMLElement) || !(label instanceof HTMLElement)) {
      return;
    }
    banner.hidden = !active;
    label.textContent = active
      ? "See which API a number comes from — click a blue number to start"
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

  highlight(rect: OverlayAvoidRect | null): void {
    if (!this.hit) {
      return;
    }
    if (!rect) {
      this.hit.hidden = true;
      return;
    }
    const pad = 3;
    this.hit.hidden = false;
    this.hit.style.left = `${Math.round(rect.left - pad)}px`;
    this.hit.style.top = `${Math.round(rect.top - pad)}px`;
    this.hit.style.width = `${Math.round(rect.right - rect.left + pad * 2)}px`;
    this.hit.style.height = `${Math.round(rect.bottom - rect.top + pad * 2)}px`;
  }

  getCardRect(): OverlayAvoidRect | null {
    if (!this.card || this.card.hidden) {
      return null;
    }
    return this.cardRect;
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
    this.card.scrollTop = 0;
    this.card.replaceChildren();

    const header = document.createElement("div");
    header.className = "header";
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = "API";
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
    this.card.scrollTop = 0;
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
      this.card.scrollTop = 0;
      this.card.hidden = true;
      this.card.replaceChildren();
    }
    this.pinnedKey = "";
    this.pointerInside = false;
    this.locked = false;
    this.currentMatches = [];
    this.avoid = null;
    this.cardRect = null;
  }

  contains(target: EventTarget | null): boolean {
    return Boolean(this.host && target instanceof Node && this.host.contains(target));
  }

  destroy(): void {
    this.highlight(null);
    this.hideCard();
    this.host?.remove();
    this.host = null;
    this.shadow = null;
    this.card = null;
    this.hit = null;
    this.onSelect = null;
    this.onStopInspect = null;
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
    const height = Math.min(this.card.offsetHeight || 180, 300);
    const chosen = pickPlacement(clientX, clientY, CARD_WIDTH, height, this.avoid);
    this.card.style.left = `${Math.round(chosen.x)}px`;
    this.card.style.top = `${Math.round(chosen.y)}px`;
    this.cardRect = {
      left: chosen.x,
      top: chosen.y,
      right: chosen.x + CARD_WIDTH,
      bottom: chosen.y + height,
    };
  }
}

function pickPlacement(
  clientX: number,
  clientY: number,
  width: number,
  height: number,
  avoid: OverlayAvoidRect | null,
): { x: number; y: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const pad = 8;
  const gap = 12;
  const candidates: { x: number; y: number }[] = [];
  const shortNumber = Boolean(avoid && avoid.bottom - avoid.top <= 56);
  if (avoid) {
    const below = { x: avoid.left, y: avoid.bottom + gap };
    const right = { x: avoid.right + gap, y: avoid.top };
    const left = { x: avoid.left - width - gap, y: avoid.top };
    const above = { x: avoid.left, y: avoid.top - height - gap };
    candidates.push(shortNumber ? below : right, shortNumber ? right : below, left, above);
  }
  candidates.push({ x: clientX + 18, y: clientY + 20 }, { x: clientX - width - 12, y: clientY + 20 });

  let best = candidates[0];
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    const x = clamp(candidate.x, pad, Math.max(pad, vw - width - pad));
    const y = clamp(candidate.y, pad, Math.max(pad, vh - height - pad));
    const fitsX = candidate.x >= pad && candidate.x + width <= vw - pad;
    const fitsY = candidate.y >= pad && candidate.y + height <= vh - pad;
    let score = (fitsX ? 40 : 0) + (fitsY ? 40 : 0);
    if (avoid && !overlaps(x, y, width, height, avoid)) {
      score += 80;
    }
    if (avoid) {
      const dx = x + width / 2 - (avoid.left + avoid.right) / 2;
      const dy = y + height / 2 - (avoid.top + avoid.bottom) / 2;
      score -= Math.hypot(dx, dy) * 0.2;
    }
    if (score > bestScore) {
      bestScore = score;
      best = { x, y };
    }
  }
  return best;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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
  .hit {
    position: fixed;
    pointer-events: none;
    z-index: 2147483645;
    box-sizing: border-box;
    border: 2px solid #8ab4f8;
    border-radius: 6px;
    background: rgba(26, 115, 232, 0.2);
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.35);
  }
  .banner {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 2147483646;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    min-height: 32px;
    padding: 6px 40px;
    box-sizing: border-box;
    background: #1a73e8;
    color: #fff;
    font: 12px/18px Arial, Helvetica, sans-serif;
    text-align: center;
    pointer-events: auto;
  }
  .banner-text {
    min-width: 0;
    max-width: min(720px, calc(100vw - 80px));
  }
  .banner-close {
    position: absolute;
    right: 8px;
    top: 50%;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 0;
    background: transparent;
    color: #fff;
    font: 18px/28px Arial, Helvetica, sans-serif;
    transform: translateY(-50%);
    cursor: pointer;
  }
  .banner-close:hover {
    background: rgba(0, 0, 0, 0.18);
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
