export type MatchType = "exact" | "normalized";

export interface RequestMeta {
  requestId: string;
  url: string;
  method: string;
  status: number;
  durationMs: number;
  mimeType: string;
  resourceType: string;
  timestamp: number;
}

export interface FlattenedEntry {
  jsonPath: string;
  rawValue: string | number;
  normalizedValues: string[];
}

export interface CapturedResponse {
  tabId: number;
  meta: RequestMeta;
  requestBody?: string;
  responseBody: unknown;
  entries: FlattenedEntry[];
}

export interface IndexedValue {
  requestId: string;
  url: string;
  method: string;
  status: number;
  durationMs: number;
  jsonPath: string;
  rawValue: string | number;
  timestamp: number;
  resourceType: string;
}

export interface ValueMatch extends IndexedValue {
  displayUrl: string;
  matchType: MatchType;
  contextScore?: number;
  likely?: boolean;
}

export interface ExtractedValue {
  rawText: string;
  primaryKey: string;
  lookupKeys: string[];
}

export interface UiHint {
  labels: string[];
  tokens: string[];
}

export interface LookupRequest {
  tabId?: number;
  keys: string[];
  primaryKey: string;
  pageUrl: string;
  hints?: UiHint;
}

export interface LookupResult {
  matches: ValueMatch[];
}

export interface InspectPayload {
  tabId: number;
}

export interface SelectSourcePayload {
  tabId: number;
  requestId: string;
  jsonPath: string;
}

export interface ExchangeRequest {
  tabId?: number;
  requestId: string;
}

export interface RequestExchange {
  url: string;
  method: string;
  status: number;
  requestBody: string;
  responseBody: unknown;
}

export interface PanelSelection {
  meta: RequestMeta;
  responseBody: unknown;
  jsonPath: string;
  rawValue: string | number;
}

export interface TabStatus {
  tabId: number;
  requestCount: number;
  valueCount: number;
  inspectActive: boolean;
  hasDevTools: boolean;
  lastCaptureUrl: string;
  /** Chrome will not run this extension on the tab (Web Store, chrome://, and similar). */
  restricted?: boolean;
}

export interface RawNetworkCapture {
  url: string;
  method: string;
  status: number;
  durationMs: number;
  mimeType: string;
  resourceType: string;
  bodyText: string;
  requestText?: string;
}
