import { extractValues } from "../shared/normalize";
import type { ExtractedValue } from "../shared/types";

const IGNORE_TAGS = new Set(["HTML", "BODY", "SCRIPT", "STYLE", "LINK", "META", "HEAD"]);
const HOST_ID = "valuetrace-root";

export function isExtensionNode(node: EventTarget | null): boolean {
  if (!(node instanceof Node)) {
    return false;
  }
  const root = document.getElementById(HOST_ID);
  return Boolean(root && root.contains(node));
}

export function resolveHoveredValue(start: Element): { element: Element; value: ExtractedValue } | null {
  let current: Element | null = start;

  for (let depth = 0; depth < 6 && current; depth += 1) {
    if (current.id === HOST_ID || IGNORE_TAGS.has(current.tagName)) {
      current = current.parentElement;
      continue;
    }

    const text = readShortText(current);
    const values = extractValues(text);
    if (values.length > 0) {
      return { element: current, value: pickBestValue(values) };
    }
    current = current.parentElement;
  }

  return null;
}

function readShortText(el: Element): string {
  const html = el as HTMLElement;
  const text = html.innerText ?? el.textContent ?? "";
  if (text.length === 0 || text.length > 280) {
    return "";
  }
  return text;
}

function pickBestValue(values: ExtractedValue[]): ExtractedValue {
  return values.slice().sort((a, b) => b.rawText.length - a.rawText.length)[0];
}

export { HOST_ID };
