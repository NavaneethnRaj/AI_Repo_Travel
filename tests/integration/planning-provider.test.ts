import { expect, it } from "vitest";
import { FinishReason } from "@google/genai";
import type { GenerateContentParameters, GenerateContentResponse, Models } from "@google/genai";
import { geminiProvider } from "../../apps/api/src/providers/gemini.js";
import { ProviderFailure } from "../../apps/api/src/providers/provider.js";
import type { ProviderRequest } from "../../apps/api/src/providers/provider.js";
import { scriptedProvider } from "../../apps/api/src/providers/scripted.js";

const request: ProviderRequest = {
  system: "", contents: "", intent: "inspire", input: { kind: "mood", moodId: "food" }, attempt: "initial",
};

async function collect(provider: ReturnType<typeof scriptedProvider>, signal = new AbortController().signal) {
  const chunks: string[] = [];
  for await (const chunk of provider.stream(request, signal)) chunks.push(chunk);
  return chunks;
}

it("decodes UTF-8 chunks even when a character spans byte boundaries", async () => {
  const bytes = new TextEncoder().encode("Cafés");
  const provider = scriptedProvider(() => Array.from(bytes, (byte) => ({ bytes: Uint8Array.of(byte) })));
  expect((await collect(provider)).join("")).toBe("Cafés");
});

it("preserves typed scripted failures", async () => {
  const provider = scriptedProvider(() => [{ failure: new ProviderFailure("RATE_LIMITED", 12) }]);
  await expect(collect(provider)).rejects.toMatchObject({ code: "RATE_LIMITED", retryAfterSeconds: 12 });
});

it("aborts a delayed script", async () => {
  const controller = new AbortController();
  const provider = scriptedProvider(() => [{ bytes: Uint8Array.of(65), delayMs: 1000 }]);
  const pending = collect(provider, controller.signal);
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
});

it("configures text-only Gemini streaming without tools and yields SDK text", async () => {
  let received: GenerateContentParameters | undefined;
  const client = {
    async generateContentStream(params: GenerateContentParameters) {
      received = params;
      async function* chunks(): AsyncGenerator<GenerateContentResponse> {
        yield { text: "root = Reply([])\n" } as GenerateContentResponse;
      }
      return chunks();
    },
  } satisfies Pick<Models, "generateContentStream">;
  const provider = geminiProvider({ apiKey: "test-only", model: "offline-model", client });

  expect((await collect(provider)).join("")).toBe("root = Reply([])\n");
  expect(received?.model).toBe("offline-model");
  expect(received?.contents).toBe(request.contents);
  expect(received?.config?.systemInstruction).toBe(request.system);
  expect(received?.config?.maxOutputTokens).toBe(8000);
  expect(received?.config?.responseMimeType).toBe("text/plain");
  expect(received?.config?.automaticFunctionCalling).toEqual({ disable: true });
  expect(received?.config?.tools).toBeUndefined();
});

it("maps Gemini errors to redacted typed failures", async () => {
  const client = {
    async generateContentStream() {
      throw Object.assign(new Error("secret request body"), { status: 429, headers: new Headers({ "retry-after": "8" }) });
    },
  } as unknown as Pick<Models, "generateContentStream">;
  const provider = geminiProvider({ apiKey: "test-only", model: "offline-model", client });
  await expect(collect(provider)).rejects.toMatchObject({ name: "Error", code: "RATE_LIMITED", retryAfterSeconds: 8, message: "RATE_LIMITED" });
});

it("rejects a safety-blocked Gemini candidate", async () => {
  const client = {
    async generateContentStream() {
      async function* chunks(): AsyncGenerator<GenerateContentResponse> {
        yield { candidates: [{ finishReason: FinishReason.SAFETY }] } as GenerateContentResponse;
      }
      return chunks();
    },
  } satisfies Pick<Models, "generateContentStream">;
  await expect(collect(geminiProvider({ apiKey: "test-only", model: "offline-model", client })))
    .rejects.toMatchObject({ code: "SAFETY_BLOCKED" });
});
