import { extractValues, stripNumericTokens } from "../shared/normalize";
import type { ExtractedValue, UiHint } from "../shared/types";
import { tokenizeHints } from "../shared/ui-context";

const IGNORE_TAGS = new Set(["HTML", "BODY", "SCRIPT", "STYLE", "LINK", "META", "HEAD"]);
const HOST_ID = "valuetrace-root";
const EMPTY_HINTS: UiHint = { labels: [], tokens: [] };
const UNIT_LABEL = /^(min|mins|minutes|minute|%|sec|secs|guests|guest)$/i;

export function isExtensionNode(node: EventTarget | null): boolean {
  if (!(node instanceof Node)) {
    return false;
  }
  const root = document.getElementById(HOST_ID);
  return Boolean(root && root.contains(node));
}

export function resolveHoveredValue(
  start: Element,
  clientX: number,
  clientY: number,
): { element: Element; value: ExtractedValue; hints: UiHint } | null {
  let current: Element | null = start;

  for (let depth = 0; depth < 6 && current; depth += 1) {
    if (current.id === HOST_ID || IGNORE_TAGS.has(current.tagName)) {
      current = current.parentElement;
      continue;
    }

    const own = readOwnValue(current);
    if (own) {
      return pack(own.element, own.value);
    }

    const hit = findValueInChildren(current, clientX, clientY, 0);
    if (hit) {
      return pack(hit.element, hit.value);
    }

    current = current.parentElement;
  }

  return null;
}

export function highlightBounds(el: Element): { left: number; top: number; right: number; bottom: number } {
  const rect = el.getBoundingClientRect();
  const next = el.nextElementSibling;
  if (next && isPercentMark(next.textContent)) {
    const extra = next.getBoundingClientRect();
    return {
      left: Math.min(rect.left, extra.left),
      top: Math.min(rect.top, extra.top),
      right: Math.max(rect.right, extra.right),
      bottom: Math.max(rect.bottom, extra.bottom),
    };
  }
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
}

export function isOnResolvedValue(el: Element, clientX: number, clientY: number, pad = 3): boolean {
  const bounds = highlightBounds(el);
  return (
    clientX >= bounds.left - pad &&
    clientX <= bounds.right + pad &&
    clientY >= bounds.top - pad &&
    clientY <= bounds.bottom + pad
  );
}

function pack(
  element: Element,
  value: ExtractedValue,
): { element: Element; value: ExtractedValue; hints: UiHint } {
  return { element, value, hints: collectNearbyLabel(element, value) };
}

function readOwnValue(el: Element): { element: Element; value: ExtractedValue } | null {
  const values = extractValues(displayText(el));
  if (values.length === 1) {
    return { element: el, value: values[0] };
  }
  return null;
}

/** Prefer the element's own text so sibling KPIs are not swallowed. */
export function displayText(el: Element): string {
  let own = "";
  for (let i = 0; i < el.childNodes.length; i += 1) {
    const node = el.childNodes[i];
    if (node.nodeType === Node.TEXT_NODE) {
      own += node.textContent ?? "";
    }
  }
  own = own.trim();
  if (own && isPercentMark(el.nextElementSibling?.textContent)) {
    return `${own}%`;
  }
  if (own) {
    return own;
  }
  const full = (el.textContent ?? "").trim();
  if (!full || full.length > 36 || el.childElementCount > 3) {
    return "";
  }
  return full;
}

function findValueInChildren(
  el: Element,
  clientX: number,
  clientY: number,
  depth: number,
): { element: Element; value: ExtractedValue } | null {
  if (depth > 4) {
    return null;
  }
  for (let i = 0; i < el.childElementCount; i += 1) {
    const child = el.children[i];
    if (child.id === HOST_ID || IGNORE_TAGS.has(child.tagName)) {
      continue;
    }
    if (!containsPoint(child, clientX, clientY)) {
      continue;
    }
    const own = readOwnValue(child);
    if (own) {
      return own;
    }
    const deeper = findValueInChildren(child, clientX, clientY, depth + 1);
    if (deeper) {
      return deeper;
    }
  }
  return null;
}

function containsPoint(el: Element, clientX: number, clientY: number): boolean {
  const rect = el.getBoundingClientRect();
  return (
    clientX >= rect.left - 4 &&
    clientX <= rect.right + 4 &&
    clientY >= rect.top - 4 &&
    clientY <= rect.bottom + 4
  );
}

function isPercentMark(text: string | null | undefined): boolean {
  return (text ?? "").trim() === "%";
}

function collectNearbyLabel(start: Element, value: ExtractedValue): UiHint {
  const labels: string[] = [];
  takeLabel(start.previousElementSibling, labels);
  takeLabel(start.parentElement?.previousElementSibling ?? null, labels);
  takeLabel(start.nextElementSibling, labels);
  const parent = start.parentElement;
  if (parent && parent.childElementCount <= 4) {
    for (let i = 0; i < parent.childElementCount; i += 1) {
      const child = parent.children[i];
      if (child !== start) {
        takeLabel(child, labels);
      }
    }
  }
  const own = stripNumericTokens(displayText(start)).trim();
  if (own && own !== value.rawText) {
    labels.push(own);
  }
  const uniqueLabels = [...new Set(labels)].filter((label) => !isJunkLabel(label)).slice(0, 3);
  if (uniqueLabels.length === 0) {
    return EMPTY_HINTS;
  }
  return { labels: uniqueLabels, tokens: tokenizeHints(uniqueLabels) };
}

function isJunkLabel(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 36 || UNIT_LABEL.test(trimmed)) {
    return true;
  }
  const mins = trimmed.match(/min/gi)?.length ?? 0;
  const passes = trimmed.match(/pass/gi)?.length ?? 0;
  return mins >= 2 || passes >= 2;
}

function takeLabel(el: Element | null, labels: string[]): void {
  if (!el) {
    return;
  }
  const text = (el.textContent ?? "").trim();
  if (!text || text.length > 80) {
    return;
  }
  const cleaned = stripNumericTokens(text).trim();
  if (cleaned) {
    labels.push(cleaned);
  }
}

export { HOST_ID };
