import { FinishReason, GoogleGenAI, ThinkingLevel } from "@google/genai";
import type { GenerateContentParameters, Models } from "@google/genai";
import type { PlanningProvider, ProviderRequest } from "./provider.js";
import { maxOutputTokens, ProviderFailure } from "./provider.js";

type StreamClient = Pick<Models, "generateContentStream">;

function retryAfter(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("headers" in error)) return undefined;
  const headers = error.headers;
  if (!headers || typeof headers !== "object" || !("get" in headers) || typeof headers.get !== "function") return undefined;
  const value = headers.get("retry-after");
  if (typeof value !== "string" || !/^\d+$/.test(value)) return undefined;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : undefined;
}

function failure(error: unknown, signal: AbortSignal): Error {
  if (signal.aborted) return signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");
  if (error && typeof error === "object" && "name" in error && error.name === "AbortError") {
    return new ProviderFailure("TIMEOUT");
  }
  if (error && typeof error === "object" && "status" in error && error.status === 429) {
    return new ProviderFailure("RATE_LIMITED", retryAfter(error));
  }
  return new ProviderFailure("UNAVAILABLE");
}

export function geminiProvider(options: {
  apiKey: string;
  model: string;
  client?: StreamClient;
}): PlanningProvider {
  const client = options.client ?? new GoogleGenAI({ apiKey: options.apiKey, vertexai: false }).models;

  return {
    async *stream(request: ProviderRequest, signal: AbortSignal) {
      const params: GenerateContentParameters = {
        model: options.model,
        contents: request.contents,
        config: {
          systemInstruction: request.system,
          maxOutputTokens,
          responseMimeType: "text/plain",
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
          automaticFunctionCalling: { disable: true },
          abortSignal: signal,
        },
      };

      let stream: AsyncGenerator<Awaited<ReturnType<Models["generateContentStream"]>> extends AsyncGenerator<infer T> ? T : never>;
      try {
        stream = await client.generateContentStream(params);
      } catch (error) {
        throw failure(error, signal);
      }

      try {
        for await (const chunk of stream) {
          signal.throwIfAborted();
          if (chunk.promptFeedback?.blockReason) throw new ProviderFailure("SAFETY_BLOCKED");
          const candidate = chunk.candidates?.[0];
          if (candidate?.finishReason === FinishReason.SAFETY || candidate?.finishReason === FinishReason.BLOCKLIST) {
            throw new ProviderFailure("SAFETY_BLOCKED");
          }
          if (chunk.text) yield chunk.text;
        }
      } catch (error) {
        if (error instanceof ProviderFailure) throw error;
        throw failure(error, signal);
      }
    },
  };
}
