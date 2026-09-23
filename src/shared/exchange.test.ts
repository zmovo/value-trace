import { describe, expect, it } from "vitest";
import { capturedFromRaw } from "./ingest";
import { exchangeFilename, formatExchangeText, toCurl } from "./exchange";
import { ValueIndex } from "./value-index";
import { flattenJson } from "./json-flatten";

describe("formatExchangeText", () => {
  it("writes URL, request, and response into one text file", () => {
    const text = formatExchangeText({
      url: "https://example.test/api/incident-record-management/api/v1/incident/records",
      method: "POST",
      status: 200,
      requestBody: '{"zoneId":1}',
      responseBody: { data: { total: 4330 } },
    });
    expect(text).toBe(
      [
        "URL",
        "https://example.test/api/incident-record-management/api/v1/incident/records",
        "",
        "Request",
        "POST",
        "{\n  \"zoneId\": 1\n}",
        "",
        "Response",
        "200",
        "{\n  \"data\": {\n    \"total\": 4330\n  }\n}",
        "",
      ].join("\n"),
    );
  });

  it("marks a missing request body", () => {
    const text = formatExchangeText({
      url: "https://example.test/mock/dashboard",
      method: "GET",
      status: 200,
      requestBody: "",
      responseBody: { data: { entryCount: 66860 } },
    });
    expect(text).toContain("Request\nGET\n(empty)");
  });
});

describe("toCurl", () => {
  it("includes the method, url, and json body", () => {
    expect(toCurl("POST", "https://example.test/api/zone", '{"id":1}')).toBe(
      "curl -X POST 'https://example.test/api/zone' -H 'Content-Type: application/json' --data-raw '{\"id\":1}'",
    );
    expect(toCurl("GET", "https://example.test/api/zone", "")).toBe("curl 'https://example.test/api/zone'");
  });
});

describe("exchangeFilename", () => {
  it("uses the method and the last path segments", () => {
    expect(
      exchangeFilename("POST", "https://host/api/incident-record-management/api/v1/incident/records"),
    ).toBe("valuetrace-post-v1-incident-records.txt");
  });
});

describe("request exchange storage", () => {
  it("returns the stored request and response for a match", () => {
    const index = new ValueIndex();
    const body = { data: { total: 4330 } };
    index.addCaptured({
      tabId: 1,
      meta: {
        requestId: "rec",
        url: "https://example.test/api/v1/incident/records",
        method: "POST",
        status: 200,
        durationMs: 40,
        mimeType: "application/json",
        resourceType: "fetch",
        timestamp: 10,
      },
      requestBody: '{"zoneId":1}',
      responseBody: body,
      entries: flattenJson(body),
    });

    expect(index.getExchange("rec")).toMatchObject({
      url: "https://example.test/api/v1/incident/records",
      method: "POST",
      status: 200,
      requestBody: '{"zoneId":1}',
      responseBody: body,
    });
  });

  it("borrows the request body from the same call captured with a different query", () => {
    const index = new ValueIndex();
    const body = { data: { total: 4330 } };
    const meta = {
      method: "POST",
      status: 200,
      durationMs: 40,
      mimeType: "application/json",
      resourceType: "fetch",
      timestamp: 10,
    };
    index.addCaptured({
      tabId: 1,
      meta: {
        ...meta,
        requestId: "with-body",
        url: "https://example.test/api/v1/incident/records",
      },
      requestBody: '{"zoneId":1}',
      responseBody: body,
      entries: [],
    });
    index.addCaptured({
      tabId: 1,
      meta: {
        ...meta,
        requestId: "shown",
        url: "https://example.test/api/v1/incident/records?t=2",
      },
      responseBody: body,
      entries: [],
    });
    expect(index.getExchange("shown")?.requestBody).toBe('{"zoneId":1}');
  });

  it("fills a request body captured a second time for the same call", () => {
    const index = new ValueIndex();
    index.addCaptured({
      tabId: 1,
      meta: {
        requestId: "rec",
        url: "https://example.test/api/v1/incident/records",
        method: "POST",
        status: 200,
        durationMs: 40,
        mimeType: "application/json",
        resourceType: "fetch",
        timestamp: 10,
      },
      responseBody: { ok: true },
      entries: [],
    });
    index.setRequestBody("rec", '{"zoneId":1}');
    expect(index.getExchange("rec")?.requestBody).toBe('{"zoneId":1}');
    index.setRequestBody("rec", '{"zoneId":2}');
    expect(index.getExchange("rec")?.requestBody).toBe('{"zoneId":1}');
  });

  it("keeps the raw request text when indexing a page capture", () => {
    const captured = capturedFromRaw(1, {
      url: "https://example.test/api/v1/incident/records",
      method: "post",
      status: 200,
      durationMs: 12,
      mimeType: "application/json",
      resourceType: "fetch",
      bodyText: '{"total":4330}',
      requestText: '{"zoneId":1}',
    });
    expect(captured?.meta.method).toBe("POST");
    expect(captured?.requestBody).toBe('{"zoneId":1}');
  });
});
