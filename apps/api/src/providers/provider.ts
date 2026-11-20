import type { TurnInput, TurnIntent } from "@wayfarer/contracts";

export const maxOutputTokens = 8000;

export type ProviderRequest = {
  system: string;
  contents: string;
  intent: TurnIntent;
  input: TurnInput;
  attempt: "initial" | "repair";
};

type FailureCode = "RATE_LIMITED" | "TIMEOUT" | "SAFETY_BLOCKED" | "UNAVAILABLE";

export class ProviderFailure extends Error {
  constructor(readonly code: FailureCode, readonly retryAfterSeconds?: number) {
    super(code);
  }
}

export interface PlanningProvider {
  stream(request: ProviderRequest, signal: AbortSignal): AsyncIterable<string>;
}
