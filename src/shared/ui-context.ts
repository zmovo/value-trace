import type { UiHint, ValueMatch } from "./types";

const IGNORE = new Set([
  "the",
  "and",
  "for",
  "of",
  "to",
  "a",
  "an",
  "is",
  "at",
  "on",
  "by",
  "or",
  "with",
  "from",
  "this",
  "that",
  "data",
  "value",
  "values",
  "item",
  "items",
  "list",
  "result",
  "results",
  "payload",
  "response",
  "body",
  "row",
  "rows",
  "record",
  "records",
  "content",
  "info",
  "object",
  "array",
  "api",
  "http",
  "https",
  "www",
  "com",
  "html",
  "div",
  "span",
  "btn",
  "button",
  "text",
  "num",
  "val",
  "key",
  "idx",
  "index",
  "v1",
  "v2",
  "v3",
]);

const GROUPS: string[][] = [
  ["total", "totals", "sum", "amount", "总计", "总数", "合计", "总量", "总共"],
  ["entry", "entries", "enter", "inbound", "incoming", "in", "入场", "进入", "进客", "总入场"],
  ["exit", "exits", "outbound", "outgoing", "out", "出场", "离场", "出客", "总出场"],
  ["guest", "guests", "visitor", "visitors", "unique", "客流", "访客", "客人"],
  ["avg", "average", "mean", "平均"],
  ["map", "heatmap"],
  ["current", "realtime", "real", "live", "now", "当前", "实时"],
  ["count", "counts", "number", "qty", "quantity"],
  ["rate", "ratio", "percent", "percentage", "占比"],
  ["dwell", "duration", "time", "min", "mins", "minute", "minutes", "停留", "时长"],
  ["exist", "existing", "occupancy", "present", "在场", "现存"],
  ["absent", "absence", "离岗"],
  ["trend", "history", "historical", "趋势"],
  ["queue", "queuing", "queueing", "wait", "waiting", "排队"],
  ["fast", "express"],
  ["pass", "lane"],
  ["regular"],
  ["seat", "seats", "available"],
];

const COMPOUNDS: Record<string, string[]> = {
  totalentries: ["total", "entry"],
  totalentry: ["total", "entry"],
  entryguests: ["entry", "guest"],
  exitguests: ["exit", "guest"],
  currentguests: ["current", "guest"],
  existingguests: ["exist", "guest"],
  entrycount: ["entry", "count"],
  exitcount: ["exit", "count"],
  avgmap: ["avg", "map"],
  fastpass: ["fast", "pass"],
  fastpasstime: ["fast", "pass", "time"],
  queueingcount: ["queue", "count"],
  queuingcount: ["queue", "count"],
  availableseats: ["available", "seat"],
  总入场: ["total", "entry"],
  总出场: ["total", "exit"],
};

const SYNONYM = new Map<string, string[]>();
for (const group of GROUPS) {
  for (const token of group) {
    SYNONYM.set(token, group);
  }
}

export function tokenize(text: string): string[] {
  if (!text) {
    return [];
  }
  const spaced = text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2");
  const parts = spaced
    .split(/[^A-Za-z0-9\u4e00-\u9fff]+/)
    .flatMap(splitCjk)
    .map((part) => part.toLowerCase())
    .filter((part) => part.length >= 2 && !IGNORE.has(part) && !/^\d+$/.test(part));
  return unique(parts);
}

export function tokenizeHints(parts: string[]): string[] {
  const tokens = new Set<string>();
  for (const part of parts) {
    const words = tokenize(part);
    for (const token of words) {
      tokens.add(token);
      for (const extra of COMPOUNDS[token] ?? []) {
        tokens.add(extra);
      }
    }
    for (let i = 0; i < words.length - 1; i += 1) {
      const pair = `${words[i]}${words[i + 1]}`;
      for (const extra of COMPOUNDS[pair] ?? []) {
        tokens.add(extra);
      }
    }
  }
  return [...tokens];
}

export function tokensFromJsonPath(jsonPath: string): string[] {
  return tokenize(jsonPath.replace(/\[\d+\]/g, "."));
}

export function tokensFromUrl(url: string): string[] {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    return tokenizeHints(parts.slice(-4));
  } catch {
    return tokenizeHints(url.split("/").filter(Boolean).slice(-4));
  }
}

export function scoreField(jsonPath: string, url: string, hintTokens: string[]): number {
  if (hintTokens.length === 0) {
    return 0;
  }
  const hints = expandAll(hintTokens);
  let score = 0;
  const used = new Set<string>();

  for (const token of tokensFromJsonPath(jsonPath)) {
    const hit = matchToken(token, hintTokens, hints);
    if (hit && !used.has(token)) {
      used.add(token);
      score += hit;
      continue;
    }
    if (!hit) {
      score -= 1;
    }
  }

  for (const token of tokensFromUrl(url)) {
    if (used.has(token) || IGNORE.has(token)) {
      continue;
    }
    const hit = matchToken(token, hintTokens, hints);
    if (!hit) {
      continue;
    }
    used.add(token);
    score += 1;
  }

  return Math.max(0, score);
}

export function scoreMatches(matches: ValueMatch[], hints: UiHint | undefined): ValueMatch[] {
  const tokens = hints?.tokens ?? [];
  return matches.map((match) => ({
    ...match,
    contextScore: tokens.length > 0 ? scoreField(match.jsonPath, match.url, tokens) : 0,
    likely: false,
  }));
}

/** Caller must sort by contextScore first. Drops weaker hits when one field is clearly better. */
export function pickLikelyMatches<T extends { contextScore?: number; likely?: boolean }>(
  matches: T[],
): T[] {
  if (matches.length === 0) {
    return matches;
  }
  if (matches.length === 1) {
    return (matches[0].contextScore ?? 0) >= 2 ? [{ ...matches[0], likely: true }] : matches;
  }

  const best = matches[0].contextScore ?? 0;
  const second = matches[1].contextScore ?? 0;
  if (best >= 2 && best - second >= 2) {
    return [{ ...matches[0], likely: true }];
  }
  return matches.map((match, index) => ({
    ...match,
    likely: index === 0 && best >= 2 && best > second,
  }));
}

function matchToken(token: string, rawHints: string[], expandedHints: Set<string>): number {
  if (expandedHints.has(token)) {
    return token.length >= 4 ? 3 : 2;
  }
  for (const alias of SYNONYM.get(token) ?? []) {
    if (expandedHints.has(alias)) {
      return token.length >= 4 ? 3 : 2;
    }
  }
  if (token.length < 3) {
    return 0;
  }
  for (const hint of rawHints) {
    if (hint.length < 3) {
      continue;
    }
    if (token.includes(hint) || hint.includes(token)) {
      return 2;
    }
  }
  return 0;
}

function expandAll(tokens: string[]): Set<string> {
  const out = new Set<string>();
  for (const token of tokens) {
    out.add(token);
    for (const extra of COMPOUNDS[token] ?? []) {
      out.add(extra);
    }
    for (const alias of SYNONYM.get(token) ?? [token]) {
      out.add(alias);
    }
  }
  return out;
}

function splitCjk(part: string): string[] {
  if (!/[\u4e00-\u9fff]/.test(part)) {
    return part ? [part] : [];
  }
  const extras = [part];
  for (const phrase of Object.keys(COMPOUNDS)) {
    if (/[\u4e00-\u9fff]/.test(phrase) && part.includes(phrase)) {
      extras.push(phrase);
    }
  }
  return extras;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
