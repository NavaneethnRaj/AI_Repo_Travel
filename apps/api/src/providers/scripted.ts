import { setTimeout } from "node:timers/promises";
import type { MoodId } from "@wayfarer/contracts";
import type { PlanningProvider, ProviderRequest } from "./provider.js";
import { ProviderFailure } from "./provider.js";

export type ScriptStep =
  | { bytes: Uint8Array; delayMs?: number }
  | { failure: ProviderFailure; delayMs?: number };

export function scriptedProvider(select: (request: ProviderRequest) => readonly ScriptStep[]): PlanningProvider {
  return {
    async *stream(request, signal) {
      const decoder = new TextDecoder("utf-8", { fatal: true });
      for (const step of select(request)) {
        signal.throwIfAborted();
        if (step.delayMs) await setTimeout(step.delayMs, undefined, { signal });
        if ("failure" in step) throw step.failure;

        let text: string;
        try {
          text = decoder.decode(step.bytes, { stream: true });
        } catch {
          throw new ProviderFailure("UNAVAILABLE");
        }
        if (text) yield text;
      }

      try {
        const remaining = decoder.decode();
        if (remaining) yield remaining;
      } catch (error) {
        if (!(error instanceof TypeError)) throw error;
        throw new ProviderFailure("UNAVAILABLE");
      }
    },
  };
}

const reasons: Record<MoodId, string> = {
  slow: "Take a slower pace with garden walks, cafés and views over the river.",
  food: "Try neighbourhood bakeries, market lunches and cafés between viewpoints.",
  culture: "Spend a weekend exploring tiled streets, museums and neighbourhood cafés.",
  outdoors: "Try a city break with steep viewpoints and walking routes.",
  coast: "Use the city as a starting point for stops along the coast.",
};

export const mockProvider = scriptedProvider(({ input, intent }) => {
  const why = input.kind === "mood" ? reasons[input.moodId]
    : intent === "refine" ? "Keep the city as a base and leave more time between stops."
    : "Explore neighbourhood cafés, tiled streets and viewpoints at your own pace.";
  const encode = new TextEncoder();
  return [
    { bytes: encode.encode("root = Reply([card])\n"), delayMs: 150 },
    { bytes: encode.encode('card = Destination'), delayMs: 150 },
    { bytes: encode.encode(`Card("lisbon", ${JSON.stringify(why)}, null, [4500, 7500], "EUR")\n`), delayMs: 150 },
  ];
});
