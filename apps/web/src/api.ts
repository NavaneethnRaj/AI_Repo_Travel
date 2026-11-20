import type { ApiError } from "@wayfarer/contracts";

type Options = { method: "POST" | "PATCH"; body: unknown };

export type RequestApi = <T>(path: string, options?: Options) => Promise<T>;

export class ApiFailure extends Error {
  constructor(readonly status: number, readonly detail?: ApiError["error"]) {
    super("Request failed");
  }
}

export async function fetchApi<T>(path: string, options?: Options, csrf?: string): Promise<T> {
  const response = await fetch(new URL(`/api/v1${path}`, window.location.origin), {
    credentials: "same-origin",
    ...(options ? {
      method: options.method,
      body: JSON.stringify(options.body),
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf ?? "" },
    } : {}),
  });

  if (!response.ok) {
    const envelope: ApiError | null = await response.json().catch(() => null);
    throw new ApiFailure(response.status, envelope?.error);
  }
  return response.status === 204 ? undefined as T : response.json();
}
