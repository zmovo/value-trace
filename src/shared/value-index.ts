import { primaryKeyOf } from "./normalize";
import { pickLikelyMatches, scoreMatches } from "./ui-context";
import {
  canonicalRequestUrl,
  generalizeJsonPath,
  isMetadataPath,
  isXhrOrFetch,
  normalizedLeaf,
  toDisplayUrl,
  urlAffinity,
} from "./url";
import type {
  CapturedResponse,
  IndexedValue,
  MatchType,
  PanelSelection,
  RequestMeta,
  UiHint,
  ValueMatch,
} from "./types";

const MAX_MATCHES_PER_KEY = 100;
const MAX_SHOWN = 5;
const AMBIGUOUS_KEYS = new Set(["0", "1"]);

interface StoredRequest {
  meta: RequestMeta;
  responseBody: unknown;
}

/**
 * Reverse index: normalizedValue → matches.
 * Built when a response arrives so hover lookups stay O(1).
 *
 * Future derived matches (e.g. 66860 - 52113 = 14747) can be appended
 * in addCaptured without changing Inspector / Overlay contracts.
 */
export class ValueIndex {
  private readonly byValue = new Map<string, IndexedValue[]>();
  private readonly requests = new Map<string, StoredRequest>();
  private indexedValues = 0;

  addCaptured(captured: CapturedResponse): number {
    this.requests.set(captured.meta.requestId, {
      meta: captured.meta,
      responseBody: captured.responseBody,
    });

    let added = 0;
    for (const entry of captured.entries) {
      const record: IndexedValue = {
        requestId: captured.meta.requestId,
        url: captured.meta.url,
        method: captured.meta.method,
        status: captured.meta.status,
        durationMs: captured.meta.durationMs,
        jsonPath: entry.jsonPath,
        rawValue: entry.rawValue,
        timestamp: captured.meta.timestamp,
        resourceType: captured.meta.resourceType,
      };

      for (const key of entry.normalizedValues) {
        const list = this.byValue.get(key) ?? [];
        if (list.length >= MAX_MATCHES_PER_KEY) {
          list.shift();
        }
        list.push(record);
        this.byValue.set(key, list);
        added += 1;
      }
      this.indexedValues += 1;
    }

    return added;
  }

  lookup(keys: string[], primaryKey: string, pageUrl: string, hints?: UiHint): ValueMatch[] {
    const merged = new Map<string, ValueMatch>();

    for (const key of keys) {
      const hits = this.byValue.get(key);
      if (!hits) {
        continue;
      }
      for (const item of hits) {
        const id = `${item.requestId}|${item.jsonPath}`;
        const matchType = classifyMatch(item.rawValue, primaryKey);
        const next: ValueMatch = {
          ...item,
          displayUrl: toDisplayUrl(item.url),
          matchType,
        };
        const existing = merged.get(id);
        if (!existing || betterMatch(next, existing, pageUrl)) {
          merged.set(id, next);
        }
      }
    }

    const collapsed = collapseMatches(
      [...merged.values()].filter((match) => !isMetadataPath(match.jsonPath)),
      pageUrl,
    );
    const ranked = rankByHints(collapseByLeaf(collapsed, pageUrl), hints, pageUrl);
    return capMatches(ranked, primaryKey).slice(0, MAX_SHOWN);
  }

  getSelection(requestId: string, jsonPath: string): PanelSelection | null {
    const stored = this.requests.get(requestId);
    if (!stored) {
      return null;
    }

    const hit = this.lookupByPath(requestId, jsonPath);
    return {
      meta: stored.meta,
      responseBody: stored.responseBody,
      jsonPath,
      rawValue: hit?.rawValue ?? "",
    };
  }

  clear(): void {
    this.byValue.clear();
    this.requests.clear();
    this.indexedValues = 0;
  }

  stats(): { requestCount: number; valueCount: number } {
    return {
      requestCount: this.requests.size,
      valueCount: this.indexedValues,
    };
  }

  private lookupByPath(requestId: string, jsonPath: string): IndexedValue | null {
    for (const list of this.byValue.values()) {
      const found = list.find((item) => item.requestId === requestId && item.jsonPath === jsonPath);
      if (found) {
        return found;
      }
    }
    return null;
  }
}

/**
 * One UI number should not explode into 100 rows.
 * Keep the latest hit per API + field, and treat array indexes as the same field.
 */
function rankByHints(matches: ValueMatch[], hints: UiHint | undefined, pageUrl: string): ValueMatch[] {
  if (!hints?.tokens.length) {
    return matches;
  }
  const ranked = scoreMatches(matches, hints);
  ranked.sort((a, b) => {
    const delta = (b.contextScore ?? 0) - (a.contextScore ?? 0);
    if (delta !== 0) {
      return delta;
    }
    return compareMatches(a, b, pageUrl);
  });
  return pickLikelyMatches(ranked);
}

function capMatches(matches: ValueMatch[], primaryKey: string): ValueMatch[] {
  if (!AMBIGUOUS_KEYS.has(primaryKey)) {
    return matches;
  }
  const good = matches.filter((match) => (match.contextScore ?? 0) >= 2);
  if (good.length > 0) {
    return good;
  }
  return matches.slice(0, 3);
}

function collapseByLeaf(matches: ValueMatch[], pageUrl: string): ValueMatch[] {
  const byLeaf = new Map<string, ValueMatch>();
  const leftover: ValueMatch[] = [];
  for (const match of matches) {
    const leaf = normalizedLeaf(match.jsonPath);
    if (!leaf || leaf.length < 6 || leaf === "value" || leaf === "values") {
      leftover.push(match);
      continue;
    }
    const existing = byLeaf.get(leaf);
    if (!existing || betterMatch(match, existing, pageUrl)) {
      byLeaf.set(leaf, match);
    }
  }
  return [...byLeaf.values(), ...leftover];
}

function collapseMatches(matches: ValueMatch[], pageUrl: string): ValueMatch[] {
  const byField = new Map<string, ValueMatch>();
  for (const match of matches) {
    const key = `${match.method}|${canonicalRequestUrl(match.url)}|${generalizeJsonPath(match.jsonPath)}`;
    const existing = byField.get(key);
    if (!existing || betterMatch(match, existing, pageUrl)) {
      byField.set(key, match);
    }
  }
  return [...byField.values()].sort((a, b) => compareMatches(a, b, pageUrl));
}

function classifyMatch(rawValue: string | number, primaryKey: string): MatchType {
  return primaryKeyOf(rawValue) === primaryKey ? "exact" : "normalized";
}

function betterMatch(next: ValueMatch, existing: ValueMatch, pageUrl: string): boolean {
  return compareMatches(next, existing, pageUrl) < 0;
}

function compareMatches(a: ValueMatch, b: ValueMatch, pageUrl: string): number {
  if (a.matchType !== b.matchType) {
    return a.matchType === "exact" ? -1 : 1;
  }
  const xhrDelta = Number(isXhrOrFetch(b.resourceType)) - Number(isXhrOrFetch(a.resourceType));
  if (xhrDelta !== 0) {
    return xhrDelta;
  }
  const trendDelta = Number(isTrendUrl(a.url)) - Number(isTrendUrl(b.url));
  if (trendDelta !== 0) {
    return trendDelta;
  }
  if (a.timestamp !== b.timestamp) {
    return b.timestamp - a.timestamp;
  }
  return urlAffinity(b.url, pageUrl) - urlAffinity(a.url, pageUrl);
}

function isTrendUrl(url: string): boolean {
  return /trend/i.test(url);
}
