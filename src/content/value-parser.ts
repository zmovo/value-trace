import { extractValues, stripNumericTokens } from "../shared/normalize";
import type { ExtractedValue, UiHint } from "../shared/types";
import { tokenizeHints } from "../shared/ui-context";

const IGNORE_TAGS = new Set(["HTML", "BODY", "SCRIPT", "STYLE", "LINK", "META", "HEAD"]);
const HOST_ID = "valuetrace-root";
const EMPTY_HINTS: UiHint = { labels: [], tokens: [] };
const STICKY_MAX_W = 360;
const STICKY_MAX_H = 200;
const STICKY_MAX_AREA = 320 * 180;

export function isExtensionNode(node: EventTarget | null): boolean {
  if (!(node instanceof Node)) {
    return false;
  }
  const root = document.getElementById(HOST_ID);
  return Boolean(root && root.contains(node));
}

export function resolveHoveredValue(
  start: Element,
  clientX = 0,
  clientY = 0,
): { element: Element; value: ExtractedValue; hints: UiHint } | null {
  let current: Element | null = start;

  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (current.id === HOST_ID || IGNORE_TAGS.has(current.tagName)) {
      current = current.parentElement;
      continue;
    }

    const text = readShortText(current);
    const values = extractValues(text);
    if (values.length > 0) {
      const value = pickNearestValue(current, values, clientX, clientY);
      return { element: current, value, hints: collectNearbyLabel(current, value) };
    }
    current = current.parentElement;
  }

  return null;
}

/** Grow the hover target to the map pin / KPI card, not just the digit span. */
export function stickyHoverElement(el: Element): Element {
  let current = el;
  let best = el;
  for (let i = 0; i < 5 && current.parentElement; i += 1) {
    const parent = current.parentElement;
    if (IGNORE_TAGS.has(parent.tagName) || parent.id === HOST_ID) {
      break;
    }
    const rect = parent.getBoundingClientRect();
    if (rect.width > STICKY_MAX_W || rect.height > STICKY_MAX_H || rect.width * rect.height > STICKY_MAX_AREA) {
      break;
    }
    if (rect.width * rect.height < 24) {
      break;
    }
    best = parent;
    current = parent;
  }
  return best;
}

/**
 * innerText forces layout and walks the whole visible subtree.
 * Only read textContent on small nodes (the number itself or its card).
 */
function readShortText(el: Element): string {
  if (!isCheapNode(el)) {
    return "";
  }
  const text = el.textContent ?? "";
  if (text.length === 0 || text.length > 280) {
    return "";
  }
  return text;
}

function isCheapNode(el: Element): boolean {
  if (el.childElementCount > 4) {
    return false;
  }
  for (let i = 0; i < el.childElementCount; i += 1) {
    if (el.children[i].childElementCount > 4) {
      return false;
    }
  }
  return true;
}

function pickNearestValue(el: Element, values: ExtractedValue[], clientX: number, clientY: number): ExtractedValue {
  if (values.length === 1) {
    return values[0];
  }

  let best = values[0];
  let bestDist = Number.POSITIVE_INFINITY;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const text = node.data;
    for (const value of values) {
      const index = text.indexOf(value.rawText);
      if (index < 0) {
        continue;
      }
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + value.rawText.length);
      const rect = range.getBoundingClientRect();
      const dx = (rect.left + rect.right) / 2 - clientX;
      const dy = (rect.top + rect.bottom) / 2 - clientY;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        best = value;
      }
    }
  }
  return best;
}

/** Previous/next siblings only — do not grab the other column on a map pin. */
function collectNearbyLabel(start: Element, value: ExtractedValue): UiHint {
  const labels: string[] = [];
  takeLabel(start.previousElementSibling, labels);
  takeLabel(start.previousElementSibling?.previousElementSibling ?? null, labels);
  takeLabel(start.nextElementSibling, labels);
  const own = stripNumericTokens(readShortText(start)).trim();
  if (own && own !== value.rawText) {
    labels.push(own);
  }
  if (labels.length === 0) {
    return EMPTY_HINTS;
  }
  const uniqueLabels = [...new Set(labels)].slice(0, 3);
  return { labels: uniqueLabels, tokens: tokenizeHints(uniqueLabels) };
}

function takeLabel(el: Element | null, labels: string[]): void {
  if (!el || !isCheapNode(el)) {
    return;
  }
  const text = el.textContent ?? "";
  if (text.length === 0 || text.length > 80) {
    return;
  }
  const cleaned = stripNumericTokens(text).trim();
  if (cleaned) {
    labels.push(cleaned);
  }
}

export { HOST_ID };
