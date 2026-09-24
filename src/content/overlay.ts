import type { ValueMatch } from "../shared/types";
import { presentJsonPath, presentRequestUrl } from "../shared/url";
import { HOST_ID } from "./value-parser";

export interface OverlayClickDetail {
  match: ValueMatch;
}

const CARD_WIDTH = 440;
const BANNER_MARGIN = 16;
const BANNER_SNAP = 40;

export interface BannerPoint {
  left: number;
  top: number;
}

const bannerMemory = globalThis as typeof globalThis & {
  __valueTraceBannerPos?: BannerPoint;
};

export function defaultBannerPosition(
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
): BannerPoint {
  return clampBannerPosition(
    (viewportWidth - width) / 2,
    viewportHeight - height - BANNER_MARGIN,
    width,
    height,
    viewportWidth,
    viewportHeight,
  );
}

export function clampBannerPosition(
  left: number,
  top: number,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
): BannerPoint {
  const maxLeft = Math.max(BANNER_MARGIN, viewportWidth - width - BANNER_MARGIN);
  const maxTop = Math.max(BANNER_MARGIN, viewportHeight - height - BANNER_MARGIN);
  return {
    left: clamp(left, BANNER_MARGIN, maxLeft),
    top: clamp(top, BANNER_MARGIN, maxTop),
  };
}

export function dockBannerPosition(
  left: number,
  top: number,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
): BannerPoint {
  const parked = clampBannerPosition(left, top, width, height, viewportWidth, viewportHeight);
  const maxLeft = Math.max(BANNER_MARGIN, viewportWidth - width - BANNER_MARGIN);
  const maxTop = Math.max(BANNER_MARGIN, viewportHeight - height - BANNER_MARGIN);
  let x = parked.left;
  let y = parked.top;
  if (x - BANNER_MARGIN <= BANNER_SNAP) {
    x = BANNER_MARGIN;
  } else if (maxLeft - x <= BANNER_SNAP) {
    x = maxLeft;
  }
  if (y - BANNER_MARGIN <= BANNER_SNAP) {
    y = BANNER_MARGIN;
  } else if (maxTop - y <= BANNER_SNAP) {
    y = maxTop;
  }
  return { left: x, top: y };
}

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
  private bannerPos: BannerPoint | null = null;
  private bannerDrag: {
    pointerId: number;
    x: number;
    y: number;
    left: number;
    top: number;
    moved: boolean;
  } | null = null;
  private readonly onViewportResize = (): void => {
    this.layoutBanner(false);
  };

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
    shadow.innerHTML = `${styles}<div class="banner" hidden><span class="banner-grip" title="Drag to move" aria-hidden="true"></span><span class="banner-mark" aria-hidden="true">V</span><span class="banner-copy"><strong class="banner-name">ValueTrace</strong><span class="banner-text"></span></span><button type="button" class="banner-close">Stop</button></div><div class="hit" hidden></div><div class="card" hidden></div>`;

    this.host = host;
    this.shadow = shadow;
    this.card = shadow.querySelector(".card");
    this.hit = shadow.querySelector(".hit");
    const banner = this.shadow.querySelector(".banner");
    if (banner instanceof HTMLElement) {
      banner.addEventListener("pointerdown", this.onBannerPointerDown as EventListener);
      banner.addEventListener("pointermove", this.onBannerPointerMove as EventListener);
      banner.addEventListener("pointerup", this.onBannerPointerUp as EventListener);
      banner.addEventListener("pointercancel", this.onBannerPointerUp as EventListener);
    }
    this.shadow.querySelector(".banner-close")?.addEventListener(
      "pointerdown",
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.onStopInspect?.();
      },
      true,
    );
    window.addEventListener("resize", this.onViewportResize);
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
        const node = event.target instanceof Node ? event.target : null;
        const from = node instanceof Element ? node : node?.parentElement;
        const selectingUrl = Boolean(from?.closest(".url-path"));
        if (!selectingUrl) {
          event.preventDefault();
        }
        event.stopPropagation();
        if (selectingUrl) {
          return;
        }
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
    banner.classList.remove("is-warn");
    label.textContent = active ? "Click a number" : "";
    if (active) {
      this.layoutBanner(false);
    }
  }

  isInspecting(): boolean {
    const banner = this.shadow?.querySelector(".banner");
    return banner instanceof HTMLElement && !banner.hidden;
  }

  notify(text: string, emphasis?: string): void {
    const banner = this.shadow?.querySelector(".banner");
    const label = this.shadow?.querySelector(".banner-text");
    if (!(banner instanceof HTMLElement) || banner.hidden || !(label instanceof HTMLElement)) {
      return;
    }
    const previous = label.textContent ?? "";
    banner.classList.add("is-warn");
    label.replaceChildren();
    if (emphasis && text.includes(emphasis)) {
      const [before, after] = text.split(emphasis);
      const strong = document.createElement("strong");
      strong.textContent = emphasis;
      label.append(document.createTextNode(before), strong, document.createTextNode(after));
    } else {
      label.textContent = text;
    }
    window.setTimeout(() => {
      if (label.textContent === text) {
        banner.classList.remove("is-warn");
        label.textContent = previous;
      }
    }, 2600);
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
    this.bannerDrag = null;
    window.removeEventListener("resize", this.onViewportResize);
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

    const data = document.createElement("div");
    data.className = "data";
    const head = document.createElement("div");
    head.className = "data-head";
    const headLabel = document.createElement("span");
    headLabel.textContent = total > 1 && match.likely ? "Response data · best" : "Response data";
    head.append(headLabel);
    const body = document.createElement("div");
    body.className = "data-body";
    body.append(
      dataRow("Field", fieldText, "field", index, fieldText),
      dataRow("Value", formatHeaderValue(match.rawValue), "value", index, String(match.rawValue)),
    );
    data.append(head, body);

    const actions = document.createElement("div");
    actions.className = "actions";
    actions.append(actionButton("download", index), actionButton("curl", index));

    row.append(urlBox, data, actions);
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

  private bannerElement(): HTMLElement | null {
    const banner = this.shadow?.querySelector(".banner");
    return banner instanceof HTMLElement ? banner : null;
  }

  private layoutBanner(dock: boolean): void {
    const banner = this.bannerElement();
    if (!banner || banner.hidden) {
      return;
    }
    const width = banner.offsetWidth;
    const height = banner.offsetHeight;
    if (width < 1 || height < 1) {
      return;
    }
    const saved = this.bannerPos ?? bannerMemory.__valueTraceBannerPos ?? null;
    const next = saved
      ? (dock ? dockBannerPosition : clampBannerPosition)(
          saved.left,
          saved.top,
          width,
          height,
          window.innerWidth,
          window.innerHeight,
        )
      : defaultBannerPosition(width, height, window.innerWidth, window.innerHeight);
    this.commitBanner(banner, next, true);
  }

  private commitBanner(banner: HTMLElement, pos: BannerPoint, remember: boolean): void {
    banner.style.left = `${Math.round(pos.left)}px`;
    banner.style.top = `${Math.round(pos.top)}px`;
    banner.style.right = "auto";
    banner.style.bottom = "auto";
    banner.style.transform = "none";
    this.bannerPos = pos;
    if (remember) {
      bannerMemory.__valueTraceBannerPos = pos;
    }
  }

  private onBannerPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) {
      return;
    }
    const banner = this.bannerElement();
    const node = event.target instanceof Element ? event.target : null;
    if (!banner || node?.closest(".banner-close")) {
      return;
    }
    const rect = banner.getBoundingClientRect();
    this.bannerDrag = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: rect.left,
      top: rect.top,
      moved: false,
    };
    banner.setPointerCapture(event.pointerId);
  };

  private onBannerPointerMove = (event: PointerEvent): void => {
    const drag = this.bannerDrag;
    const banner = this.bannerElement();
    if (!drag || !banner || event.pointerId !== drag.pointerId) {
      return;
    }
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) {
      return;
    }
    drag.moved = true;
    banner.classList.add("is-dragging");
    event.preventDefault();
    this.commitBanner(
      banner,
      clampBannerPosition(
        drag.left + dx,
        drag.top + dy,
        banner.offsetWidth,
        banner.offsetHeight,
        window.innerWidth,
        window.innerHeight,
      ),
      false,
    );
  };

  private onBannerPointerUp = (event: PointerEvent): void => {
    const drag = this.bannerDrag;
    const banner = this.bannerElement();
    if (!drag || !banner || event.pointerId !== drag.pointerId) {
      return;
    }
    this.bannerDrag = null;
    banner.classList.remove("is-dragging");
    if (!drag.moved) {
      return;
    }
    const rect = banner.getBoundingClientRect();
    this.commitBanner(
      banner,
      dockBannerPosition(
        rect.left,
        rect.top,
        banner.offsetWidth,
        banner.offsetHeight,
        window.innerWidth,
        window.innerHeight,
      ),
      true,
    );
  };

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

function dataRow(
  label: string,
  text: string,
  kind: "field" | "value",
  index: number,
  title: string,
): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "data-row";
  const name = document.createElement("div");
  name.className = "data-label";
  name.textContent = label;
  const value = document.createElement("div");
  value.className = "data-value";
  value.textContent = text;
  value.title = title;
  row.append(name, value, iconButton(kind, index, kind === "field" ? "Copy field" : "Copy value"));
  return row;
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
    left: 50%;
    bottom: 16px;
    transform: translateX(-50%);
    z-index: 2147483646;
    cursor: grab;
    touch-action: none;
    user-select: none;
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: min(720px, calc(100vw - 24px));
    padding: 8px 8px 8px 10px;
    box-sizing: border-box;
    border-radius: 999px;
    background: #1c1f27;
    color: #f4f5f7;
    border: 1px solid rgba(255, 255, 255, 0.14);
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45);
    font: 12px/1.3 "Segoe UI", system-ui, sans-serif;
    pointer-events: auto;
  }
  .banner.is-dragging {
    cursor: grabbing;
  }
  .banner-grip {
    flex: none;
    width: 10px;
    height: 16px;
    margin-right: -2px;
    background-image: radial-gradient(circle, #8b919c 1.15px, transparent 1.25px);
    background-size: 5px 5px;
    background-position: 0 1px;
  }
  .banner-mark {
    flex: none;
    width: 22px;
    height: 22px;
    border-radius: 6px;
    background: #1a73e8;
    color: #fff;
    font: 700 13px/22px Arial, Helvetica, sans-serif;
    text-align: center;
  }
  .banner-copy {
    min-width: 0;
    padding-right: 4px;
  }
  .banner-name,
  .banner-text {
    display: block;
  }
  .banner-name {
    font-size: 12px;
    font-weight: 700;
  }
  .banner-text {
    color: #b7bdc7;
    white-space: nowrap;
  }
  .banner.is-warn .banner-text {
    color: #f6d48a;
  }
  .banner-text strong {
    color: #fff;
    font-weight: 700;
  }
  .banner-close {
    flex: none;
    border: 0;
    border-radius: 999px;
    padding: 6px 12px;
    background: #2a303a;
    color: #fff;
    font: 650 12px/1.2 "Segoe UI", system-ui, sans-serif;
    cursor: pointer;
    touch-action: manipulation;
  }
  .banner-close:hover {
    background: #343b48;
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
    font-weight: 700;
    font-size: 18px;
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
  .url-box {
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
  .url-text {
    flex: 1;
    min-width: 0;
  }
  .url-path,
  .url-service,
  .data-value {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .url-path {
    color: #f4f5f7;
    font: 13px/1.35 Consolas, "Cascadia Mono", ui-monospace, monospace;
    user-select: text;
    cursor: text;
  }
  .url-service {
    margin-top: 2px;
    color: #9aa1ad;
    font: 12px/1.3 Consolas, "Cascadia Mono", ui-monospace, monospace;
  }
  .data {
    margin-top: 12px;
    padding: 10px;
    border-radius: 14px;
    background: #23262f;
    border: 1px solid rgba(255, 255, 255, 0.06);
  }
  .data-head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 4px 8px;
    color: #d5d8e0;
    font-size: 13px;
    font-weight: 650;
  }
  .data-body {
    border-radius: 10px;
    background: #15181e;
    overflow: hidden;
  }
  .data-row {
    display: grid;
    grid-template-columns: 52px minmax(0, 1fr) 28px;
    align-items: center;
    gap: 8px;
    min-height: 42px;
    padding: 6px 8px 6px 14px;
  }
  .data-row + .data-row {
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
  }
  .data-label {
    color: #9aa1ad;
    font-size: 13px;
  }
  .data-value {
    color: #f4f5f7;
    text-align: left;
    font: 600 14px/1.3 Consolas, "Cascadia Mono", ui-monospace, monospace;
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
  .action-title,
  .action-sub { display: block; text-align: left; }
  .action-title { font-size: 13px; font-weight: 650; }
  .action-sub { margin-top: 1px; color: #9aa1ad; font-size: 11px; font-weight: 500; }
  .pressed { color: #fff; }
</style>
`;
