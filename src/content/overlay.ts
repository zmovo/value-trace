import type { ValueMatch } from "../shared/types";
import { presentJsonPath, presentRequestUrl } from "../shared/url";
import { HOST_ID } from "./value-parser";

export interface OverlayClickDetail {
  match: ValueMatch;
}

const CARD_WIDTH = 440;

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
  private onDownload: ((match: ValueMatch) => Promise<boolean>) | null = null;
  private onCurl: ((match: ValueMatch) => Promise<string | null>) | null = null;
  private onDismiss: (() => void) | null = null;
  private pinnedKey = "";
  private pointerInside = false;
  private locked = false;
  private currentMatches: ValueMatch[] = [];
  private avoid: OverlayAvoidRect | null = null;
  private cardRect: OverlayAvoidRect | null = null;
  private hit: HTMLDivElement | null = null;

  mount(
    onSelect: (detail: OverlayClickDetail) => void,
    onStopInspect?: () => void,
    onDownload?: (match: ValueMatch) => Promise<boolean>,
    onCurl?: (match: ValueMatch) => Promise<string | null>,
    onDismiss?: () => void,
  ): void {
    this.onSelect = onSelect;
    this.onStopInspect = onStopInspect ?? null;
    this.onDownload = onDownload ?? null;
    this.onCurl = onCurl ?? null;
    this.onDismiss = onDismiss ?? null;
    if (this.host) {
      return;
    }

    const host = document.createElement("div");
    host.id = HOST_ID;
    host.setAttribute("data-valuetrace", "root");
    host.style.cssText =
      "all:initial;position:fixed;z-index:2147483646;top:0;left:0;width:0;height:0;overflow:visible;pointer-events:none;";
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
        if (from?.closest("[data-close]")) {
          this.onDismiss?.();
          return;
        }
        const downloadBtn = from?.closest("[data-download-index]");
        if (downloadBtn) {
          const index = Number(downloadBtn.getAttribute("data-download-index"));
          const match = this.currentMatches[index];
          if (match) {
            void this.downloadMatch(match, downloadBtn);
          }
          return;
        }
        const curlBtn = from?.closest("[data-curl-index]");
        if (curlBtn) {
          const index = Number(curlBtn.getAttribute("data-curl-index"));
          const match = this.currentMatches[index];
          if (match) {
            void this.copyCurl(match, curlBtn);
          }
          return;
        }
        const copyBtn = from?.closest("[data-copy-kind]");
        if (copyBtn) {
          const index = Number(copyBtn.getAttribute("data-index"));
          const match = this.currentMatches[index];
          const kind = copyBtn.getAttribute("data-copy-kind");
          if (match && (kind === "url" || kind === "field" || kind === "value")) {
            void this.copyPiece(match, kind, copyBtn);
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

  isInspecting(): boolean {
    const banner = this.shadow?.querySelector(".banner");
    return banner instanceof HTMLElement && !banner.hidden;
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
    title.textContent = uiLabel || "Source";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "close";
    close.setAttribute("data-close", "1");
    close.setAttribute("aria-label", "Close");
    close.textContent = "×";
    if (matches.length > 1) {
      const count = document.createElement("div");
      count.className = "count";
      count.textContent = `${matches.length} sources`;
      header.append(title, count, close);
    } else {
      header.append(title, close);
    }
    this.card.appendChild(header);

    matches.forEach((match, index) => {
      this.card?.appendChild(this.renderRow(match, index, matches.length));
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
    this.onDownload = null;
    this.onCurl = null;
    this.onDismiss = null;
  }

  private renderRow(match: ValueMatch, index: number, total: number): HTMLDivElement {
    const row = document.createElement("div");
    row.className = "row";
    const shown = presentRequestUrl(match.displayUrl);
    const fieldText = presentJsonPath(match.jsonPath);

    const urlBox = document.createElement("div");
    urlBox.className = "url-box";
    const method = document.createElement("span");
    method.className = "method";
    method.dataset.method = match.method.toLowerCase();
    method.textContent = match.method;
    const urlText = document.createElement("div");
    urlText.className = "url-text";
    const urlPath = document.createElement("div");
    urlPath.className = "url-path";
    urlPath.textContent = shown.path;
    urlPath.title = match.url;
    urlText.appendChild(urlPath);
    if (shown.service) {
      const service = document.createElement("div");
      service.className = "url-service";
      service.textContent = shown.service;
      urlText.appendChild(service);
    }
    urlBox.append(method, urlText, iconButton("url", index, "Click to copy URL"));

    const fieldLabelEl = document.createElement("div");
    fieldLabelEl.className = "section-label";
    fieldLabelEl.textContent = total > 1 && match.likely ? "Response field · best" : "Response field";
    const fieldBox = boxedValue(fieldText, "field", index, match.jsonPath);

    const valueLabel = document.createElement("div");
    valueLabel.className = "section-label";
    valueLabel.textContent = "Value";
    const valueBox = boxedValue(formatHeaderValue(match.rawValue), "value", index, String(match.rawValue));

    const actions = document.createElement("div");
    actions.className = "actions";
    actions.append(actionButton("download", index), actionButton("curl", index));

    row.append(urlBox, fieldLabelEl, fieldBox, valueLabel, valueBox, actions);
    return row;
  }

  private async downloadMatch(match: ValueMatch, button: Element): Promise<void> {
    if (!this.onDownload || button.hasAttribute("data-busy")) {
      return;
    }
    const sub = button.querySelector(".action-sub");
    if (!(sub instanceof HTMLElement)) {
      return;
    }
    button.setAttribute("data-busy", "1");
    const label = sub.textContent;
    sub.textContent = "Saving…";
    const ok = await this.onDownload(match);
    sub.textContent = ok ? "Saved" : "Failed";
    window.setTimeout(() => {
      sub.textContent = label;
      button.removeAttribute("data-busy");
    }, 1200);
  }

  private async copyPiece(
    match: ValueMatch,
    kind: "url" | "field" | "value",
    button: Element,
  ): Promise<void> {
    const text =
      kind === "url" ? match.url : kind === "field" ? presentJsonPath(match.jsonPath) : String(match.rawValue);
    const ok = await writeClipboard(text);
    flashIcon(button, ok);
  }

  private async copyCurl(match: ValueMatch, button: Element): Promise<void> {
    if (!this.onCurl || button.hasAttribute("data-busy")) {
      return;
    }
    const title = button.querySelector(".action-title");
    if (!(title instanceof HTMLElement)) {
      return;
    }
    button.setAttribute("data-busy", "1");
    const label = title.textContent;
    title.textContent = "Copying…";
    const curl = await this.onCurl(match);
    const ok = curl != null && (await writeClipboard(curl));
    title.textContent = ok ? "Copied" : "Failed";
    window.setTimeout(() => {
      title.textContent = label;
      button.removeAttribute("data-busy");
    }, 1200);
  }

  private placeAtCursor(clientX: number, clientY: number): void {
    if (!this.card) {
      return;
    }
    const height = Math.min(this.card.offsetHeight || 280, 560);
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

function formatHeaderValue(value: string | number): string {
  const numeric = typeof value === "number" ? value : /^-?\d+(?:\.\d+)?$/.test(String(value)) ? Number(value) : Number.NaN;
  if (!Number.isFinite(numeric)) {
    return String(value);
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(numeric);
}

function boxedValue(text: string, kind: "field" | "value", index: number, title: string): HTMLDivElement {
  const box = document.createElement("div");
  box.className = "box";
  const label = document.createElement("div");
  label.className = "box-text";
  label.textContent = text;
  label.title = title;
  box.append(label, iconButton(kind, index, kind === "field" ? "Copy field" : "Copy value"));
  return box;
}

function iconButton(kind: "url" | "field" | "value", index: number, title: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "icon";
  button.setAttribute("data-copy-kind", kind);
  button.setAttribute("data-index", String(index));
  button.title = title;
  button.innerHTML = `<span class="ico">${copyIcon}</span>`;
  return button;
}

function actionButton(kind: "download" | "curl", index: number): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "action";
  if (kind === "download") {
    button.setAttribute("data-download-index", String(index));
    button.innerHTML = `<span class="ico">${downloadIcon}</span><span class="action-copy"><span class="action-title">Download</span><span class="action-sub">URL + Request + Response</span></span>`;
  } else {
    button.classList.add("is-primary");
    button.setAttribute("data-curl-index", String(index));
    button.innerHTML = `<span class="ico">${curlIcon}</span><span class="action-copy"><span class="action-title">Copy cURL</span></span>`;
  }
  return button;
}

function flashIcon(button: Element, ok: boolean): void {
  const icon = button.querySelector(".ico");
  if (!(icon instanceof HTMLElement)) {
    return;
  }
  const previous = icon.innerHTML;
  icon.innerHTML = ok ? checkIcon : previous;
  button.classList.toggle("is-done", ok);
  if (!ok) {
    button.classList.add("is-fail");
  }
  window.setTimeout(() => {
    icon.innerHTML = previous;
    button.classList.remove("is-done", "is-fail");
  }, 1200);
}

const copyIcon = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
const checkIcon = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 12.5 9.2 17 19 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const downloadIcon = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 4v10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="m8 10 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 19h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
const curlIcon = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="m4 8 4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M11 16h8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;

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
  [hidden] {
    display: none !important;
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
    width: 100vw;
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
    max-height: min(560px, calc(100vh - 24px));
    overflow: auto;
    box-sizing: border-box;
    padding: 0 0 14px;
    border-radius: 18px;
    background: #1c1f27;
    color: #f4f5f7;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.48);
    border: 1px solid rgba(255, 255, 255, 0.08);
    font: 13px/1.4 "Segoe UI", system-ui, sans-serif;
    pointer-events: auto;
  }
  .card::-webkit-scrollbar {
    width: 10px;
  }
  .card::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.16);
    border: 3px solid transparent;
    border-radius: 10px;
    background-clip: padding-box;
  }
  .header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 12px 0 16px;
  }
  .title {
    min-width: 0;
    flex: 1;
    font-weight: 650;
    font-size: 16px;
    letter-spacing: -0.02em;
    overflow-wrap: anywhere;
  }
  .count {
    flex: none;
    color: #9aa1ad;
    font-size: 12px;
    font-weight: 500;
  }
  .close {
    flex: none;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: #9aa1ad;
    font: 20px/28px Arial, Helvetica, sans-serif;
    cursor: pointer;
  }
  .close:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
  }
  .row {
    box-sizing: border-box;
    margin: 0;
    padding: 12px 16px 2px;
  }
  .row + .row {
    margin-top: 8px;
    padding-top: 14px;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
  }
  .url-box,
  .box {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    box-sizing: border-box;
    border-radius: 12px;
    background: #262a33;
    padding: 8px 8px 8px 10px;
  }
  .method {
    flex: none;
    padding: 5px 8px;
    border-radius: 8px;
    background: #3c4048;
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
  }
  .method[data-method="get"] { background: #1a73e8; }
  .method[data-method="post"] { background: #1ea35a; }
  .method[data-method="put"],
  .method[data-method="patch"] { background: #c58a14; }
  .method[data-method="delete"] { background: #d04a4a; }
  .url-text,
  .box-text {
    flex: 1;
    min-width: 0;
  }
  .url-path,
  .url-service,
  .box-text {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .url-path,
  .box-text {
    color: #f4f5f7;
    font: 13px/1.35 Consolas, "Cascadia Mono", ui-monospace, monospace;
  }
  .url-service {
    margin-top: 2px;
    color: #9aa1ad;
    font: 12px/1.3 Consolas, "Cascadia Mono", ui-monospace, monospace;
  }
  .section-label {
    margin: 12px 2px 6px;
    color: #9aa1ad;
    font-size: 12px;
  }
  .box {
    background: #15181e;
    border: 1px solid rgba(255, 255, 255, 0.06);
    padding: 9px 8px 9px 12px;
  }
  .icon,
  .action {
    border: 0;
    background: transparent;
    color: #d0d3da;
    cursor: pointer;
  }
  .icon {
    display: grid;
    flex: none;
    place-items: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border-radius: 8px;
  }
  .icon:hover,
  .action:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
  }
  .icon[data-copy-kind="url"] { position: relative; }
  .icon[data-copy-kind="url"]:hover::after {
    content: "Click to copy URL";
    position: absolute;
    right: 0;
    bottom: calc(100% + 8px);
    padding: 6px 8px;
    border-radius: 8px;
    background: #111318;
    color: #f4f5f7;
    font: 12px/1.2 "Segoe UI", system-ui, sans-serif;
    white-space: nowrap;
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.35);
    pointer-events: none;
  }
  .icon.is-done { color: #81c995; }
  .icon.is-fail { color: #f28b82; }
  .actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-top: 14px;
  }
  .action {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 52px;
    padding: 8px 10px;
    border-radius: 12px;
    background: #2a2e3a;
    color: #f4f5f7;
  }
  .action:hover { background: #343846; }
  .action.is-primary {
    background: #1e7dff;
    color: #fff;
  }
  .action.is-primary:hover { background: #3b8fff; }
  .action-title,
  .action-sub { display: block; text-align: left; }
  .action-title { font-size: 13px; font-weight: 650; }
  .action-sub { margin-top: 1px; color: #9aa1ad; font-size: 11px; font-weight: 500; }
  .pressed { color: #fff; }
</style>
`;
