const FLAG = "__valueTracePageHook";
const SOURCE = "valuetrace-page";
const MAX_TEXT = 5 * 1024 * 1024;

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
  requestText: string;
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
    const requestText = snapshotRequestBody(input, init);
    return original(input, init).then((response) => {
      queueMicrotask(() => {
        void requestText.then((text) => {
          void reportFetch(input, init, response, started, text);
        });
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
  requestText: string,
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
      requestText,
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
    const requestText = readXhrBody(body);
    this.addEventListener("load", function onLoad() {
      void requestText.then((text) => {
        try {
          const mimeType = this.getResponseHeader("content-type") ?? "";
          if (!/json/i.test(mimeType)) {
            return;
          }
          const responseText = typeof this.responseText === "string" ? this.responseText : "";
          if (!responseText || responseText.length > MAX_TEXT) {
            return;
          }
          publish({
            url: this.responseURL || window.location.href,
            method: ((this as XMLHttpRequest & { __vtMethod?: string }).__vtMethod ?? "GET").toUpperCase(),
            status: this.status,
            durationMs: performance.now() - started,
            mimeType,
            resourceType: "xhr",
            requestText: text,
            bodyText: responseText,
          });
        } catch {
          // Never break the page.
        }
      });
    });
    send.call(this, body);
  };
}

function capText(text: string): string {
  if (text.length <= MAX_TEXT) {
    return text;
  }
  return `(omitted, ${text.length} bytes)`;
}

async function snapshotRequestBody(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  try {
    if (init && init.body != null) {
      return capText(await bodyInitToText(init.body));
    }
    if (input instanceof Request) {
      const length = Number(input.headers.get("content-length") ?? "0");
      if (length > MAX_TEXT) {
        return `(omitted, ${length} bytes)`;
      }
      return capText(await input.clone().text());
    }
  } catch {
    return "";
  }
  return "";
}

async function readXhrBody(body: Document | XMLHttpRequestBodyInit | null | undefined): Promise<string> {
  if (body == null) {
    return "";
  }
  try {
    if (body instanceof Document) {
      return capText(new XMLSerializer().serializeToString(body));
    }
    return capText(await bodyInitToText(body));
  } catch {
    return "";
  }
}

async function bodyInitToText(body: BodyInit): Promise<string> {
  if (typeof body === "string") {
    return body;
  }
  if (body instanceof URLSearchParams) {
    return body.toString();
  }
  if (body instanceof Blob) {
    if (body.size > MAX_TEXT) {
      return `(omitted, ${body.size} bytes)`;
    }
    return body.text();
  }
  if (body instanceof ArrayBuffer) {
    return new TextDecoder().decode(body);
  }
  if (ArrayBuffer.isView(body)) {
    return new TextDecoder().decode(body);
  }
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    const parts: string[] = [];
    body.forEach((value, key) => {
      parts.push(typeof value === "string" ? `${key}=${value}` : `${key}=[file ${value.name}]`);
    });
    return parts.join("&");
  }
  return "";
}
