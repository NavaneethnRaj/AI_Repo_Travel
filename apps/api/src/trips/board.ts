import { readFileSync } from "node:fs";
import { TripBrief, validatePlanDomain } from "@wayfarer/contracts";
import type { BoardOperation, CostSpec, DaySpec } from "@wayfarer/contracts";
import type Database from "better-sqlite3";
import { newId } from "../auth/sessions.js";
import { problem } from "../http.js";

export const catalogue = Object.freeze(JSON.parse(
  readFileSync(new URL("../../../../assets/catalog/places.json", import.meta.url), "utf8"),
) as Record<string, string>);
const catalogueIds = new Set(Object.keys(catalogue));

export function readDays(db: Database.Database, owner: string, trip: string) {
  const days = db.prepare<[string, string], Omit<DaySpec, "stops" | "date"> & { date: string | null }>(
    "SELECT d.id AS dayRef, d.ordinal, d.title, d.date FROM days d JOIN trips t ON t.id = d.trip_id WHERE t.owner_id = ? AND t.id = ? ORDER BY d.ordinal",
  ).all(owner, trip);
  const stops = db.prepare<[string, string], DaySpec["stops"][number] & { dayRef: string; pinned: number }>(`
    SELECT s.id AS ref, s.day_id AS dayRef, s.place_id AS placeId, s.label, s.period, s.time, s.minutes,
      s.transfer_minutes AS transferMinutes, s.walk_km_est AS walkKmEst, s.note, s.pinned
    FROM stops s JOIN days d ON d.id = s.day_id JOIN trips t ON t.id = d.trip_id
    WHERE t.owner_id = ? AND t.id = ? ORDER BY s.ordinal
  `).all(owner, trip);
  return {
    days: days.map(({ date, ...day }): DaySpec => ({
      ...day, ...(date ? { date } : {}),
      stops: stops.filter((stop) => stop.dayRef === day.dayRef).map(({ dayRef: _, pinned: _pin, ...stop }) =>
        Object.fromEntries(Object.entries(stop).filter(([, value]) => value !== null)) as DaySpec["stops"][number]),
    })),
    protectedStops: stops.filter((stop) => stop.pinned).map(({ dayRef, ref }) => ({ dayRef, stopRef: ref })),
  };
}

export function applyBoard(
  db: Database.Database, owner: string,
  trip: { id: string; title: string; brief_json: string; currency: string; revision: number },
  ops: readonly BoardOperation[], now: string, scope?: ReadonlySet<string>,
) {
  if (!ops.length) return trip.revision;
  let title = trip.title;
  let brief = TripBrief.parse(JSON.parse(trip.brief_json));
  const { days: currentDays, protectedStops } = readDays(db, owner, trip.id);
  const days = new Map(currentDays.map((day) => [day.dayRef, day]));
  const replacements = new Set<string>();
  const costs: CostSpec[] = [];
  for (const op of ops) {
    if (op.kind === "renameTrip") title = op.title;
    if (op.kind === "setSlot") brief = TripBrief.parse({ ...brief, [op.slot]: { source: "user", value: op.value } });
    if (op.kind === "setCosts") costs.push(...op.rows.map((row) => ({ ...row, currency: op.currency })));
    if (op.kind === "replaceDays") {
      for (const day of op.days) {
        if (replacements.has(day.dayRef)) problem(422, "DUPLICATE_ID", "A day was supplied twice");
        replacements.add(day.dayRef);
        days.set(day.dayRef, day);
      }
    }
  }
  const proposedDays = [...days.values()];
  const duration = brief.duration?.value;
  const destination = brief.destination?.value;
  if (destination && "placeId" in destination && !catalogueIds.has(destination.placeId)) {
    problem(422, "UNKNOWN_PLACE", "Destination is unavailable");
  }
  if (brief.budget?.value.currency !== undefined && brief.budget.value.currency !== trip.currency) {
    problem(422, "CURRENCY_MISMATCH", "Use the trip currency");
  }
  if (duration?.kind === "dates" && Date.parse(duration.end) - Date.parse(duration.start) >= 30 * 86400000) {
    problem(422, "INVALID_DATE_SPAN", "The trip can span up to 30 days");
  }
  if (scope && [...replacements, ...costs.map((cost) => cost.dayRef)].some((ref) => !scope.has(ref))) {
    problem(422, "OUT_OF_SCOPE", "A day is outside the allowed edit scope");
  }
  const check = validatePlanDomain({
    currentDays, proposedDays, allowedDayRefs: scope ? [...scope] : [...days.keys()],
    protectedStops, costs, currency: trip.currency, catalogueIds,
    ...(duration?.kind === "dates" ? { dateSpan: duration } : {}),
  });
  if (!check.ok) problem(422, check.code, "The proposed plan is invalid");
  if (new Set(proposedDays.map((day) => day.ordinal)).size !== proposedDays.length) {
    problem(422, "DUPLICATE_ORDINAL", "Each day needs a distinct position");
  }
  const refs = new Map(currentDays.map(({ dayRef }) => [dayRef, dayRef]));
  const move = db.prepare("UPDATE days SET ordinal = ordinal + 30 WHERE id = ? AND trip_id IN (SELECT id FROM trips WHERE owner_id = ? AND id = ?)");
  for (const ref of replacements) if (refs.has(ref)) move.run(ref, owner, trip.id);
  const update = db.prepare("UPDATE days SET ordinal = ?, title = ?, date = ? WHERE id = ? AND trip_id IN (SELECT id FROM trips WHERE owner_id = ? AND id = ?)");
  const insert = db.prepare("INSERT INTO days (id, trip_id, ordinal, title, date) SELECT ?, id, ?, ?, ? FROM trips WHERE owner_id = ? AND id = ?");
  const removeStops = db.prepare("DELETE FROM stops WHERE day_id IN (SELECT d.id FROM days d JOIN trips t ON t.id = d.trip_id WHERE d.id = ? AND t.owner_id = ? AND t.id = ?)");
  const saveStop = db.prepare(`INSERT INTO stops (id, day_id, ordinal, place_id, label, period, time, minutes, transfer_minutes, note, pinned, walk_km_est)
    SELECT ?, d.id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM days d JOIN trips t ON t.id = d.trip_id
    WHERE d.id = ? AND t.owner_id = ? AND t.id = ?`);
  for (const ref of replacements) {
    const day = days.get(ref)!;
    const existing = refs.get(ref);
    const id = existing ?? newId();
    refs.set(ref, id);
    if (existing) update.run(day.ordinal, day.title, day.date ?? null, id, owner, trip.id);
    else insert.run(id, day.ordinal, day.title, day.date ?? null, owner, trip.id);
    removeStops.run(id, owner, trip.id);
    const old = currentDays.find((item) => item.dayRef === ref);
    day.stops.forEach((submitted, index) => {
      const pinned = protectedStops.some((pin) => pin.dayRef === ref && pin.stopRef === submitted.ref);
      const original = old?.stops.find((item) => item.ref === submitted.ref);
      const stop = pinned && original ? original : submitted;
      saveStop.run(original?.ref ?? newId(), index + 1, stop.placeId ?? null, stop.label, stop.period, stop.time ?? null,
        stop.minutes ?? null, stop.transferMinutes ?? null, stop.note ?? null, Number(pinned),
        stop.walkKmEst ?? null, id, owner, trip.id);
    });
  }
  const saveCost = db.prepare(`
    INSERT INTO costs (id, day_id, category, amount_minor, currency, source)
    SELECT ?, d.id, ?, ?, ?, 'estimate' FROM days d JOIN trips t ON t.id = d.trip_id
    WHERE d.id = ? AND t.owner_id = ? AND t.id = ?
    ON CONFLICT(day_id, category) DO UPDATE SET amount_minor = excluded.amount_minor, currency = excluded.currency
  `);
  for (const cost of costs) {
    saveCost.run(newId(), cost.category, cost.amountMinor, cost.currency, refs.get(cost.dayRef), owner, trip.id);
  }
  db.prepare("UPDATE trips SET title = ?, brief_json = ?, revision = revision + 1, updated_at = ? WHERE owner_id = ? AND id = ?")
    .run(title, JSON.stringify(brief), now, owner, trip.id);
  return trip.revision + 1;
}
