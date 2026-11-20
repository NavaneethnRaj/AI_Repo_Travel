import { expect, it } from "vitest";
import { BoardRequest, validatePlanDomain } from "../../packages/contracts/src/index.js";
import type { CostSpec, DaySpec } from "../../packages/contracts/src/index.js";

const day = (dayRef: string, title: string, stops: DaySpec["stops"] = []): DaySpec => ({
  dayRef,
  ordinal: 1,
  title,
  stops,
});

const input = (overrides: Partial<Parameters<typeof validatePlanDomain>[0]> = {}) => ({
  currentDays: [day("day-1", "Lisbon")],
  proposedDays: [day("day-1", "Lisbon")],
  allowedDayRefs: ["day-1"],
  protectedStops: [],
  costs: [] as CostSpec[],
  currency: "EUR" as const,
  catalogueIds: new Set(["lisbon"]),
  ...overrides,
});

it("accepts a scoped plan and strict replacement operation", () => {
  expect(validatePlanDomain(input())).toEqual({ ok: true });
  expect(BoardRequest.safeParse({
    clientId: "1d5a1b86-9f4c-4d41-a10a-1f10b98907c1",
    baseRevision: 1,
    ops: [{ kind: "replaceDays", days: [{ dayRef: "day-1", ordinal: 1, title: "Lisbon", stops: [] }] }],
  }).success).toBe(true);
  expect(BoardRequest.safeParse({
    clientId: "1d5a1b86-9f4c-4d41-a10a-1f10b98907c1", baseRevision: 1,
    ops: [{ kind: "renameTrip", title: "Lisbon", extra: true }],
  }).success).toBe(false);
});

it("rejects day and stop limits and duplicate refs", () => {
  const tooManyDays = Array.from({ length: 31 }, (_, index) => day(`day-${index}`, "Day"));
  expect(validatePlanDomain(input({ proposedDays: tooManyDays }))).toMatchObject({ ok: false, code: "TOO_MANY_DAYS" });
  const tooManyStops = Array.from({ length: 13 }, (_, index) => ({ ref: `stop-${index}`, label: "Stop", period: "any" }));
  expect(validatePlanDomain(input({ proposedDays: [day("day-1", "Lisbon", tooManyStops)] }))).toMatchObject({ ok: false, code: "TOO_MANY_STOPS" });
  expect(validatePlanDomain(input({ proposedDays: [day("day-1", "One"), day("day-1", "Two")] }))).toMatchObject({ ok: false, code: "DUPLICATE_ID" });
  const repeated = { ref: "same", label: "Stop", period: "any" };
  expect(validatePlanDomain(input({ proposedDays: [day("day-1", "Lisbon", [repeated, repeated])] }))).toMatchObject({ ok: false, code: "DUPLICATE_ID" });
});

it("limits edits to target days and preserves protected stops", () => {
  const unchanged = day("day-2", "Porto");
  expect(validatePlanDomain(input({
    currentDays: [day("day-1", "Lisbon"), unchanged],
    proposedDays: [day("day-1", "Lisbon"), day("day-2", "Changed")],
  }))).toMatchObject({ ok: false, code: "OUT_OF_SCOPE" });
  expect(validatePlanDomain(input({
    protectedStops: [{ dayRef: "day-1", stopRef: "pinned" }],
  }))).toMatchObject({ ok: false, code: "PINNED_STOP_REMOVED" });
});

it("rejects mixed currencies, duplicate cost categories and unknown catalogue IDs", () => {
  const cost = { dayRef: "day-1", category: "food", amountMinor: 500, currency: "EUR" } as const;
  expect(validatePlanDomain(input({ costs: [{ ...cost, currency: "USD" }] }))).toMatchObject({ ok: false, code: "CURRENCY_MISMATCH" });
  expect(validatePlanDomain(input({ costs: [cost, cost] }))).toMatchObject({ ok: false, code: "DUPLICATE_COST" });
  const unlisted = { ref: "stop-1", placeId: "not-catalogued", label: "Place", period: "any" };
  expect(validatePlanDomain(input({ proposedDays: [day("day-1", "Lisbon", [unlisted])] }))).toMatchObject({ ok: false, code: "UNKNOWN_PLACE" });
});

it("keeps dated days inside a valid trip date span", () => {
  const dated = { ...day("day-1", "Lisbon"), date: "2026-08-12" };
  expect(validatePlanDomain(input({
    proposedDays: [dated], dateSpan: { start: "2026-08-10", end: "2026-08-14" },
  })).ok).toBe(true);
  expect(validatePlanDomain(input({
    proposedDays: [dated], dateSpan: { start: "2026-08-14", end: "2026-08-10" },
  }))).toMatchObject({ ok: false, code: "INVALID_DATE_SPAN" });
  expect(validatePlanDomain(input({
    proposedDays: [dated], dateSpan: { start: "2026-08-10", end: "2026-08-11" },
  }))).toMatchObject({ ok: false, code: "INVALID_DATE_SPAN" });
});
