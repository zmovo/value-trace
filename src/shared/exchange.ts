import { tryParseJson } from "./ingest";
import type { RequestExchange } from "./types";
import { apiNameSuffix } from "./url";

export function formatExchangeText(exchange: RequestExchange): string {
  return [
    "URL",
    exchange.url,
    "",
    "Request",
    exchange.method,
    formatPayload(exchange.requestBody),
    "",
    "Response",
    String(exchange.status),
    formatPayload(exchange.responseBody),
    "",
  ].join("\n");
}

export function toCurl(method: string, url: string, requestBody: string): string {
  const parts = ["curl"];
  if (method.toUpperCase() !== "GET") {
    parts.push("-X", method.toUpperCase());
  }
  parts.push(shellQuote(url));
  const body = requestBody.trim();
  if (body) {
    parts.push("-H", shellQuote("Content-Type: application/json"), "--data-raw", shellQuote(body));
  }
  return parts.join(" ");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function exchangeFilename(method: string, url: string): string {
  const suffix = apiNameSuffix(url)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  const verb = method.toLowerCase().replace(/[^a-z0-9]+/g, "") || "request";
  return `valuetrace-${verb}${suffix ? `-${suffix}` : ""}.txt`;
}

function formatPayload(value: unknown): string {
  if (value == null) {
    return "(empty)";
  }
  if (typeof value === "string") {
    if (value.trim() === "") {
      return "(empty)";
    }
    const parsed = tryParseJson(value);
    if (parsed !== undefined && typeof parsed === "object" && parsed !== null) {
      return JSON.stringify(parsed, null, 2);
    }
    return value;
  }
  try {
    return JSON.stringify(value, null, 2) ?? "(empty)";
  } catch {
    return String(value);
  }
}
