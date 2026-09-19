import { describe, expect, it } from "vitest";
import { flattenJson } from "./json-flatten";
import { extractValues, normalizeValue, primaryKeyOf } from "./normalize";
import { apiNameSuffix } from "./url";
import { ValueIndex } from "./value-index";
import type { CapturedResponse } from "./types";

describe("normalizeValue", () => {
  it("matches comma-grouped UI numbers to raw API integers", () => {
    expect(normalizeValue(66860)).toContain("66860");
    expect(normalizeValue("66,860")).toContain("66860");
    expect(primaryKeyOf("66,860")).toBe("66860");
  });

  it("matches percents to 0-1 API rates and raw percents", () => {
    expect(normalizeValue("63.2%")).toEqual(expect.arrayContaining(["63.2", "0.632"]));
    expect(normalizeValue(0.632)).toEqual(expect.arrayContaining(["0.632", "63.2"]));
    expect(normalizeValue(63.2)).toContain("63.2");
  });

  it("strips currency and thousand separators", () => {
    expect(normalizeValue("$12,350.50")).toContain("12350.5");
    expect(normalizeValue("￥1,299")).toContain("1299");
  });

  it("expands compact K/M suffixes", () => {
    expect(normalizeValue("1.2K")).toContain("1200");
    expect(normalizeValue("1.5M")).toContain("1500000");
  });
});

describe("extractValues", () => {
  it("keeps 66,860 as a single token", () => {
    const values = extractValues("Entry Guests\n66,860");
    expect(values.map((v) => v.primaryKey)).toContain("66860");
    expect(values.some((v) => v.rawText === "66")).toBe(false);
  });
});

describe("flattenJson", () => {
  it("emits JSONPath for nested objects and arrays", () => {
    const entries = flattenJson({
      data: {
        entryCount: 66860,
        list: [{ count: 100 }],
      },
    });
    const paths = entries.map((e) => e.jsonPath);
    expect(paths).toContain("$.data.entryCount");
    expect(paths).toContain("$.data.list[0].count");
  });
});

describe("apiNameSuffix", () => {
  it("keeps the last path segment for Network search", () => {
    expect(apiNameSuffix("https://host/api/v1/queue/history/query/zone/historyTrends")).toBe(
      "historyTrends",
    );
  });
});

describe("acceptance: UI 66,860 → /mock/dashboard", () => {
  it("indexes the dashboard payload and resolves the hovered token", () => {
    const index = new ValueIndex();
    const body = {
      data: {
        entryCount: 66860,
        exitCount: 52113,
        occupancyRate: 0.632,
      },
    };
    index.addCaptured({
      tabId: 1,
      meta: {
        requestId: "dash",
        url: "http://localhost:3456/mock/dashboard",
        method: "GET",
        status: 200,
        durationMs: 80,
        mimeType: "application/json",
        resourceType: "fetch",
        timestamp: 200,
      },
      responseBody: body,
      entries: flattenJson(body),
    });

    const hovered = extractValues("66,860")[0];
    const matches = index.lookup(hovered.lookupKeys, hovered.primaryKey, "http://localhost:3456/");
    expect(matches[0]?.displayUrl).toBe("/mock/dashboard");
    expect(matches[0]?.jsonPath).toBe("$.data.entryCount");
    expect(matches[0]?.rawValue).toBe(66860);
    expect(matches[0]?.matchType).toBe("exact");
  });
});

describe("ValueIndex", () => {
  it("returns multiple candidates for the same number", () => {
    const index = new ValueIndex();
    index.addCaptured(capture("r1", "/mock/dashboard", "$.data.entryCount", 66860, 100));
    index.addCaptured(capture("r2", "/mock/report", "$.data.total", 66860, 50));
    const matches = index.lookup(["66860"], "66860", "http://localhost:3456/");
    expect(matches).toHaveLength(2);
    expect(matches[0].url).toContain("/mock/dashboard");
  });

  it("collapses the same API field across polls and array indexes", () => {
    const index = new ValueIndex();
    index.addCaptured(capture("r1", "/mock/dashboard?t=1", "$.data[0].entryCount", 66860, 10));
    index.addCaptured(capture("r2", "/mock/dashboard?t=2", "$.data[3].entryCount", 66860, 20));
    index.addCaptured(capture("r3", "/mock/dashboard?t=3", "$.data[3].entryCount", 66860, 30));
    const matches = index.lookup(["66860"], "66860", "http://localhost:3456/");
    expect(matches).toHaveLength(1);
    expect(matches[0].requestId).toBe("r3");
  });
});

function capture(
  requestId: string,
  url: string,
  jsonPath: string,
  rawValue: number,
  timestamp: number,
): CapturedResponse {
  return {
    tabId: 1,
    meta: {
      requestId,
      url: `http://localhost:3456${url}`,
      method: "GET",
      status: 200,
      durationMs: 12,
      mimeType: "application/json",
      resourceType: "fetch",
      timestamp,
    },
    responseBody: {},
    entries: [
      {
        jsonPath,
        rawValue,
        normalizedValues: normalizeValue(rawValue),
      },
    ],
  };
}
