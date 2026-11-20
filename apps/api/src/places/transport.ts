export type Transport = (url: URL, init: RequestInit) => Promise<Response>;

const maxBytes = 64 * 1024;

export class UpstreamStatus extends Error {
  constructor(readonly status: number, readonly retryAfter: string | null) {
    super("Upstream request was rejected");
  }
}

export async function requestJson(
  url: URL, transport: Transport, headers: HeadersInit = { Accept: "application/json" },
): Promise<unknown> {
  const abort = new AbortController();
  const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(5000)]);
  const response = await transport(url, {
    method: "GET", headers, redirect: "error", credentials: "omit", referrerPolicy: "no-referrer", signal,
  });
  const reader = response.body?.getReader();
  let complete = false;
  try {
    if (response.redirected) throw new Error("Upstream redirect refused");
    if (!response.ok) throw new UpstreamStatus(response.status, response.headers.get("Retry-After"));
    const mime = response.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (mime !== "application/json" || !reader) throw new Error("Expected upstream JSON");

    const decoder = new TextDecoder("utf-8", { fatal: true });
    let size = 0;
    let json = "";
    for (;;) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) throw new Error("Upstream response exceeded 64 KiB");
      json += decoder.decode(chunk.value, { stream: true });
    }
    complete = true;
    return JSON.parse(json + decoder.decode()) as unknown;
  } finally {
    if (!complete) {
      abort.abort();
      void reader?.cancel().catch(() => undefined);
    }
    reader?.releaseLock();
  }
}
