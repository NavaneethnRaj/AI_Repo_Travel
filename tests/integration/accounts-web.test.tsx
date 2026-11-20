// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "../../apps/web/src/App.js";
import { authCopy, authRetryMessage } from "../../apps/web/src/auth/copy.js";

const anonymous = { user: null, csrfToken: "anonymous-fixture" };
const user = { id: "a".repeat(22), email: "fixture@example.test", currency: "USD" };
const signedIn = { user, csrfToken: "authenticated-fixture" };
const tripId = "b".repeat(22);
const trip = { id: tripId, title: "Lisbon", revision: 1, currency: "EUR", brief: {}, updatedAt: "2026-11-20T12:00:00Z" };

function mockApi(handler: (path: string, method: string, init?: RequestInit) => Response) {
  const mocked = vi.fn(async (url: URL, init?: RequestInit) => handler(url.pathname, init?.method ?? "GET", init));
  vi.stubGlobal("fetch", mocked);
  return mocked;
}

function failure(status: number, detail: { code: string; retryAfterSeconds?: number }) {
  return Response.json({ error: { message: "Fixture response", ...detail }, requestId: "fixture" }, { status });
}

function enterCredentials() {
  fireEvent.change(screen.getByLabelText("Email address"), { target: { value: user.email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "example passphrase" } });
}

function open(path: string) {
  window.history.replaceState(null, "", path);
  render(<App />);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("links invalid fields to their errors and focuses the sign-in error summary", async () => {
  const api = mockApi(() => Response.json(anonymous));
  open("/signin");
  fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));

  const summary = screen.getByRole("alert");
  expect(summary.textContent).toContain("Check the highlighted fields.");
  await waitFor(() => expect(document.activeElement).toBe(summary));
  for (const label of ["Email address", "Password"]) {
    const field = screen.getByLabelText(label);
    expect(field.getAttribute("aria-invalid")).toBe("true");
    const descriptions = field.getAttribute("aria-describedby")?.split(" ") ?? [];
    expect(descriptions.map((id) => document.getElementById(id)?.className)).toContain("field-error");
  }
  expect(api).toHaveBeenCalledTimes(1);
});

it("shows and focuses the account-neutral sign-in error", async () => {
  mockApi((path) => path.endsWith("/session") ? Response.json(anonymous) : failure(401, { code: "INVALID_CREDENTIALS" }));
  open("/signin");
  await screen.findByRole("heading", { name: "Welcome back" });
  enterCredentials();
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  const summary = await screen.findByRole("alert");
  expect(summary.textContent).toBe(authCopy.invalidCredentials);
  await waitFor(() => expect(document.activeElement).toBe(summary));
});

it("shows the 429 copy using the server wait and the correct units", async () => {
  mockApi((path) => path.endsWith("/session")
    ? Response.json(anonymous)
    : failure(429, { code: "RATE_LIMITED", retryAfterSeconds: 60 }));
  open("/signin");
  await screen.findByRole("heading", { name: "Welcome back" });
  enterCredentials();
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect((await screen.findByRole("alert")).textContent).toContain("wait 1 minute before");
  expect(authRetryMessage("signin", 2)).toContain("wait 2 seconds");
  expect(authRetryMessage("signup", 3540)).toContain("wait 59 minutes");
  expect(authRetryMessage("signup", 3600)).toContain("wait 1 hour");
});

it("shows the authenticated empty list and opens the currency form", async () => {
  mockApi((path) => Response.json(path.endsWith("/session") ? signedIn : { items: [] }));
  await act(async () => open("/trips"));
  expect(screen.getByRole("heading", { name: "No trips yet" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Start a trip" }));
  const currency = screen.getByLabelText("Currency");
  expect(document.activeElement).toBe(currency);
});

it("redirects signed-out access to sign-in without loading trip data", async () => {
  const api = mockApi(() => Response.json(anonymous));
  open(`/trips/${tripId}`);
  await screen.findByRole("heading", { name: "Welcome back" });
  expect(window.location.pathname).toBe("/signin");
  expect(api).toHaveBeenCalledTimes(1);
});

it("restores an unsent title after expired-session sign-in", async () => {
  let loggedIn = true;
  mockApi((path, method, init) => {
    if (path.endsWith("/session")) return Response.json(loggedIn ? signedIn : anonymous);
    if (method === "PATCH") {
      loggedIn = false;
      return failure(403, { code: "CSRF_REJECTED" });
    }
    if (path.endsWith("/auth/login")) {
      expect(new Headers(init?.headers).get("X-CSRF-Token")).toBe(anonymous.csrfToken);
      loggedIn = true;
      return Response.json(signedIn);
    }
    return Response.json({ trip });
  });

  open(`/trips/${tripId}`);
  const title = await screen.findByLabelText("Trip title");
  fireEvent.change(title, { target: { value: "Lisbon in spring" } });
  fireEvent.click(screen.getByRole("button", { name: "Save title" }));
  expect(await screen.findByText(authCopy.sessionExpired)).toBeTruthy();
  expect(window.location.pathname).toBe("/signin");

  enterCredentials();
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  const resumed = await screen.findByLabelText<HTMLInputElement>("Trip title");
  expect(resumed.value).toBe("Lisbon in spring");
  expect(window.location.pathname).toBe(`/trips/${tripId}`);
});
