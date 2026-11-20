import { Agent, setGlobalDispatcher } from "undici";

if (process.env.GEMINI_API_KEY !== undefined) {
  throw new Error("Offline tests require GEMINI_API_KEY to be absent");
}
if (process.env.PROVIDER !== undefined && process.env.PROVIDER !== "mock") {
  throw new Error("Offline tests require PROVIDER=mock");
}
process.env.PROVIDER = "mock";
delete process.env.GEMINI_API_KEY;
process.env.OPENUI_TELEMETRY_DISABLED = "1";

function requireLoopback(url: URL) {
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]") return;
  throw new Error("Offline tests block network requests outside loopback");
}

class LoopbackAgent extends Agent {
  override dispatch(...args: Parameters<Agent["dispatch"]>) {
    requireLoopback(new URL(String(args[0].origin)));
    return super.dispatch(...args);
  }
}

setGlobalDispatcher(new LoopbackAgent());

const fetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  requireLoopback(new URL(input instanceof Request ? input.url : input));
  return fetch(input, init);
};
