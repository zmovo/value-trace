const FLAG = "__valueTracePageHook";
const SOURCE = "valuetrace-page";

interface PageWindow extends Window {
  [FLAG]?: boolean;
}

const page = window as PageWindow;
if (!page[FLAG]) {
  page[FLAG] = true;
  installFetchHook();
  installXhrHook();
}

function publish(detail: {
  url: string;
  method: string;
  status: number;
  durationMs: number;
  mimeType: string;
  resourceType: string;
  bodyText: string;
}): void {
  window.postMessage({ source: SOURCE, type: "CAPTURE", ...detail }, window.location.origin);
}

function installFetchHook(): void {
  const original = window.fetch.bind(window);
  window.fetch = function valueTraceFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const started = performance.now();
    return original(input, init).then((response) => {
      queueMicrotask(() => {
        void reportFetch(input, init, response, started);
      });
      return response;
    });
  };
}

async function reportFetch(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  response: Response,
  started: number,
): Promise<void> {
  try {
    const mimeType = response.headers.get("content-type") ?? "";
    if (!/json/i.test(mimeType)) {
      return;
    }
    const length = Number(response.headers.get("content-length") ?? "0");
    if (length > 5 * 1024 * 1024) {
      return;
    }
    const bodyText = await response.clone().text();
    publish({
      url: response.url || resolveUrl(input),
      method: (init?.method ?? methodFromInput(input) ?? "GET").toUpperCase(),
      status: response.status,
      durationMs: performance.now() - started,
      mimeType,
      resourceType: "fetch",
      bodyText,
    });
  } catch {
    // Never break the page.
  }
}

function methodFromInput(input: RequestInfo | URL): string | undefined {
  return input instanceof Request ? input.method : undefined;
}

function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return new URL(input, window.location.href).href;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

function installXhrHook(): void {
  const open = XMLHttpRequest.prototype.open;
  const send = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function valueTraceOpen(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null,
  ): void {
    (this as XMLHttpRequest & { __vtMethod?: string }).__vtMethod = String(method);
    open.call(this, method, url, async ?? true, username, password);
  };

  XMLHttpRequest.prototype.send = function valueTraceSend(body?: Document | XMLHttpRequestBodyInit | null): void {
    const started = performance.now();
    this.addEventListener("load", function onLoad() {
      try {
        const mimeType = this.getResponseHeader("content-type") ?? "";
        if (!/json/i.test(mimeType)) {
          return;
        }
        const text = typeof this.responseText === "string" ? this.responseText : "";
        if (!text || text.length > 5 * 1024 * 1024) {
          return;
        }
        publish({
          url: this.responseURL || window.location.href,
          method: ((this as XMLHttpRequest & { __vtMethod?: string }).__vtMethod ?? "GET").toUpperCase(),
          status: this.status,
          durationMs: performance.now() - started,
          mimeType,
          resourceType: "xhr",
          bodyText: text,
        });
      } catch {
        // Never break the page.
      }
    });
    send.call(this, body);
  };
}
