import { describe, expect, it } from "vitest";
import { flattenJson } from "./json-flatten";
import { extractValues, normalizeValue, primaryKeyOf, stripNumericTokens } from "./normalize";
import { pickLikelyMatches, scoreField, tokenizeHints } from "./ui-context";
import { apiNameSuffix, fieldLabel, presentJsonPath, presentRequestUrl } from "./url";
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

  it("does not treat 100% as every JSON 1", () => {
    expect(normalizeValue("100%")).toEqual(["100"]);
    expect(normalizeValue("100.00%")).toEqual(["100"]);
    expect(normalizeValue("0%")).toEqual(["0"]);
    expect(normalizeValue("100%")).not.toContain("1");
  });

  it("does not treat 0.9 minutes as 90 percent", () => {
    expect(normalizeValue("0.9")).toEqual(["0.9"]);
    expect(normalizeValue("0.9")).not.toContain("90");
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

  it("reads a split percent like 13 % as one token", () => {
    expect(extractValues(" 13 %").map((value) => value.primaryKey)).toEqual(["13"]);
    expect(extractValues("Absent staff 26 Present Staff 4 Presence Rate 13 %")).toHaveLength(3);
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

describe("presentRequestUrl", () => {
  it("keeps the service name and the resource path", () => {
    expect(presentRequestUrl("/api/queue-management/api/v1/staff/history/query/zone")).toEqual({
      service: "queue-management",
      path: "/staff/history/query/zone",
    });
    expect(presentJsonPath("$.data.records[0].absentDuration")).toBe("data.records[0].absentDuration");
  });
});

describe("fieldLabel", () => {
  it("turns a JSON path into a readable field name", () => {
    expect(fieldLabel("$.data[1].absentTime")).toBe("Absent time");
    expect(fieldLabel("$.data.entryCount")).toBe("Entry count");
    expect(fieldLabel("$.data.list[0].sumPassCount")).toBe("Sum pass count");
    expect(fieldLabel("$.data.AVG_DWELL_TIME.data[171].value")).toBe("Avg dwell time");
    expect(fieldLabel("$.data.total.IN")).toBe("Total IN");
  });
});

describe("apiNameSuffix", () => {
  it("keeps the last three path segments for Network search", () => {
    expect(apiNameSuffix("https://host/api/crowd-management/api/v1/unique/visitor/trend")).toBe(
      "unique/visitor/trend",
    );
    expect(apiNameSuffix("https://host/api/v1/queue/history/query/zone/historyTrends")).toBe(
      "query/zone/historyTrends",
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
        url: "https://example.test/mock/dashboard",
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
    const matches = index.lookup(hovered.lookupKeys, hovered.primaryKey, "https://example.test/");
    expect(matches[0]?.displayUrl).toBe("/mock/dashboard");
    expect(matches[0]?.jsonPath).toBe("$.data.entryCount");
    expect(matches[0]?.rawValue).toBe(66860);
    expect(matches[0]?.matchType).toBe("exact");
  });
});

describe("stripNumericTokens", () => {
  it("keeps the card label next to a UI number", () => {
    expect(stripNumericTokens("Total Entries\n2,249")).toBe("Total Entries");
  });
});

describe("ui context ranking", () => {
  it("scores Total Entries closer to total.IN than avgMap or a bare value", () => {
    const tokens = tokenizeHints(["Total Entries"]);
    const total = scoreField("$.data.total.IN", "https://host/api/v1/virtualarea/multi/trend", tokens);
    const avg = scoreField("$.data.avgMap.IN", "https://host/api/v1/virtualarea/multi/trend", tokens);
    const raw = scoreField("$.data[3].value", "https://host/api/v1/virtualarea/realtime/count", tokens);
    expect(total).toBeGreaterThan(avg);
    expect(total).toBeGreaterThan(raw);
    expect(total - avg).toBeGreaterThanOrEqual(2);
    expect(
      pickLikelyMatches([
        { jsonPath: "$.data.total.IN", contextScore: total },
        { jsonPath: "$.data.avgMap.IN", contextScore: avg },
        { jsonPath: "$.data[3].value", contextScore: raw },
      ]).map((item) => item.jsonPath),
    ).toEqual(["$.data.total.IN"]);
  });
});

describe("ValueIndex", () => {
  it("uses nearby HTML labels to pick the UI field among duplicate numbers", () => {
    const index = new ValueIndex();
    index.addCaptured(capture("r1", "/api/v1/virtualarea/multi/trend", "$.data.total.IN", 2249, 30));
    index.addCaptured(capture("r2", "/api/v1/virtualarea/multi/trend", "$.data.avgMap.IN", 2249, 30));
    index.addCaptured(capture("r3", "/api/v1/virtualarea/realtime/count", "$.data[3].value", 2249, 40));
    const hints = { labels: ["Total Entries"], tokens: tokenizeHints(["Total Entries"]) };
    const matches = index.lookup(["2249"], "2249", "https://host/screen/crowdInsight", hints);
    expect(matches).toHaveLength(1);
    expect(matches[0].jsonPath).toBe("$.data.total.IN");
    expect(matches[0].likely).toBe(true);
  });

  it("drops map metadata fields like order", () => {
    const index = new ValueIndex();
    index.addCaptured(capture("r1", "/api/v1/queue/realtime/query/zone/cards", "$.data[0].queueingCount.value", 16, 10));
    index.addCaptured(capture("r2", "/api/v1/map/zone/auth/tree", "$.data[0].children[4].order", 16, 20));
    const matches = index.lookup(["16"], "16", "https://host/screen/queueInsight");
    expect(matches.map((item) => item.jsonPath)).toEqual(["$.data[0].queueingCount.value"]);
  });

  it("collapses abandonedGuests with ABANDONED_GUESTS", () => {
    const index = new ValueIndex();
    index.addCaptured(
      capture("r1", "/api/v1/queue/realtime/query/zone/overview", "$.data.zoneRealtime.abandonedGuests.value", 4292, 30),
    );
    index.addCaptured(
      capture("r2", "/api/v1/queue/realtime/query/zone/overview", "$.data.zoneTrends.ABANDONED_GUESTS.total", 4292, 10),
    );
    const matches = index.lookup(["4292"], "4292", "https://host/screen/queueInsight");
    expect(matches).toHaveLength(1);
    expect(matches[0].jsonPath).toContain("abandonedGuests");
  });

  it("keeps Fast Pass 0 from exploding into every zero field", () => {
    const index = new ValueIndex();
    index.addCaptured(capture("r1", "/api/v1/queue/realtime/query/zone/cards", "$.data[3].fastPassTime.value", 0, 10));
    index.addCaptured(capture("r2", "/api/v1/queue/realtime/query/zone/cards", "$.data[3].regularQueuingPassTime.percent", 0, 10));
    index.addCaptured(capture("r3", "/api/v1/map/zone/auth/tree", "$.data[0].children[3].map2Config.availableSeats", 0, 10));
    for (let i = 0; i < 20; i += 1) {
      index.addCaptured(capture(`z${i}`, "/api/v1/other", `$.data[${i}].unused`, 0, i));
    }
    const hints = { labels: ["Fast Pass"], tokens: tokenizeHints(["Fast Pass"]) };
    const matches = index.lookup(["0"], "0", "https://host/screen/queueInsight", hints);
    expect(matches.length).toBeLessThanOrEqual(5);
    expect(matches[0].jsonPath).toContain("fastPassTime");
  });

  it("keeps 100% exact matches above a 1.0 ratio field", () => {
    const index = new ValueIndex();
    index.addCaptured(
      capture("r1", "/api/v1/queue/realtime/query/zone/overview", "$.data.zoneRealtime.queuePercentage.value", 100, 10),
    );
    index.addCaptured(
      capture("r2", "/api/v1/queue/realtime/query/zone/overview", "$.data.zoneTrends.QUEUEING_GUEST_RATIO.data.DATA[0]", 1, 20),
    );
    const hovered = extractValues("100.00%")[0];
    const hints = { labels: ["Queue Guests"], tokens: tokenizeHints(["Queue Guests"]) };
    const matches = index.lookup(hovered.lookupKeys, hovered.primaryKey, "https://host/screen/queueInsight", hints);
    expect(matches[0]?.rawValue).toBe(100);
    expect(matches[0]?.matchType).toBe("exact");
    expect(matches[0]?.jsonPath).toContain("queuePercentage");
    expect(matches.some((item) => primaryKeyOf(item.rawValue) === "1")).toBe(false);
  });

  it("returns multiple candidates for the same number", () => {
    const index = new ValueIndex();
    index.addCaptured(capture("r1", "/mock/dashboard", "$.data.entryCount", 66860, 100));
    index.addCaptured(capture("r2", "/mock/report", "$.data.total", 66860, 50));
    const matches = index.lookup(["66860"], "66860", "https://example.test/");
    expect(matches).toHaveLength(2);
    expect(matches[0].url).toContain("/mock/dashboard");
  });

  it("collapses the same API field across polls and array indexes", () => {
    const index = new ValueIndex();
    index.addCaptured(capture("r1", "/mock/dashboard?t=1", "$.data[0].entryCount", 66860, 10));
    index.addCaptured(capture("r2", "/mock/dashboard?t=2", "$.data[3].entryCount", 66860, 20));
    index.addCaptured(capture("r3", "/mock/dashboard?t=3", "$.data[3].entryCount", 66860, 30));
    const matches = index.lookup(["66860"], "66860", "https://example.test/");
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
      url: `https://example.test${url}`,
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
