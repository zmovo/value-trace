import type { ExtractedValue } from "./types";

const CURRENCY_RE = /[$￥¥€£]/g;

/**
 * Stable string key for a finite number.
 * 66860, 66860.0 and "66,860" all become "66860".
 * 12350.50 and 12350.5 both become "12350.5".
 */
export function canonicalNumber(n: number): string {
  if (!Number.isFinite(n)) {
    return "";
  }
  const normalized = Object.is(n, -0) ? 0 : Number(n.toPrecision(12));
  return String(normalized);
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

/**
 * Extra keys so 0.632 in JSON can be found from a "63.2%" label.
 * Integers are left alone to avoid matching count=1 with 100%.
 */
function percentAliases(n: number): number[] {
  if (n > 0 && n < 1) {
    return [n, n * 100];
  }
  return [n];
}

function parseGroupedNumber(raw: string): number | null {
  const plain = raw.replace(CURRENCY_RE, "").replace(/,/g, "").trim();
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(plain)) {
    return null;
  }
  const n = Number(plain);
  return Number.isFinite(n) ? n : null;
}

/**
 * Turn an API scalar or a UI token into index / lookup keys.
 *
 *   66860        → ["66860"]
 *   "66,860"     → ["66860"]
 *   "63.2%"      → ["63.2", "0.632"]
 *   0.632        → ["0.632", "63.2"]
 *   "$12,350.50" → ["12350.5"]
 *   "1.2K"       → ["1200"]
 */
export function normalizeValue(value: unknown): string[] {
  if (typeof value === "number") {
    return unique(percentAliases(value).map(canonicalNumber));
  }
  if (typeof value !== "string") {
    return [];
  }
  const extracted = parseDisplayToken(value.trim());
  return extracted ? extracted.lookupKeys : [];
}

export function primaryKeyOf(value: string | number): string {
  if (typeof value === "number") {
    return canonicalNumber(value);
  }
  const extracted = parseDisplayToken(value.trim());
  return extracted?.primaryKey ?? "";
}

export function parseDisplayToken(text: string): ExtractedValue | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 48) {
    return null;
  }

  const percent = trimmed.match(/^[$￥¥€£\s]*([+-]?[\d,]+(?:\.\d+)?)\s*%$/);
  if (percent) {
    const n = parseGroupedNumber(percent[1]);
    if (n === null) {
      return null;
    }
    return {
      rawText: trimmed,
      primaryKey: canonicalNumber(n),
      lookupKeys: unique([canonicalNumber(n), canonicalNumber(n / 100)]),
    };
  }

  const compact = trimmed.replace(CURRENCY_RE, "").replace(/\s/g, "");
  const suffix = compact.match(/^([+-]?[\d,]+(?:\.\d+)?)([kKmM])$/);
  if (suffix) {
    const n = parseGroupedNumber(suffix[1]);
    if (n === null) {
      return null;
    }
    const scaled = n * (suffix[2].toLowerCase() === "k" ? 1_000 : 1_000_000);
    const key = canonicalNumber(scaled);
    return { rawText: trimmed, primaryKey: key, lookupKeys: [key] };
  }

  const n = parseGroupedNumber(compact);
  if (n === null) {
    return null;
  }
  return {
    rawText: trimmed,
    primaryKey: canonicalNumber(n),
    lookupKeys: unique(percentAliases(n).map(canonicalNumber)),
  };
}

/**
 * Pull recognizable UI numbers out of a short innerText.
 * Alternation order is specific → general so "66,860" is not split into 66.
 */
const VALUE_PATTERN =
  /[$￥¥€£]?\s*[+-]?[\d,]+(?:\.\d+)?\s*%|[+-]?[\d,]+(?:\.\d+)?[kKmM]\b|[$￥¥€£]\s*[+-]?[\d,]+(?:\.\d+)?|[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?|[+-]?\d+(?:\.\d+)?/g;

export function extractValues(text: string): ExtractedValue[] {
  if (!text || text.length > 400) {
    return [];
  }

  const found: ExtractedValue[] = [];
  const seen = new Set<string>();
  const tokens = text.match(VALUE_PATTERN) ?? [];

  for (const token of tokens) {
    const parsed = parseDisplayToken(token);
    if (!parsed || seen.has(parsed.rawText)) {
      continue;
    }
    seen.add(parsed.rawText);
    found.push(parsed);
  }

  return found;
}
