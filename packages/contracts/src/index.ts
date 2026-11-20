import { z } from "zod";

const supportedCurrencies = new Set(Intl.supportedValuesOf("currency"));

export const CurrencyCode = z.string().regex(/^[A-Z]{3}$/).refine(
  (value) => supportedCurrencies.has(value),
  "Unsupported ISO 4217 currency",
);

export const MinorAmount = z.int().nonnegative();
export const IsoDate = z.iso.date();
export const CatalogueId = z.string().max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const ShortLabel = z.string().min(1).max(80);
export const NoteText = z.string().min(1).max(400);

export const ApiError = z.strictObject({
  error: z.strictObject({
    code: z.string(),
    message: z.string(),
    field: z.string().optional(),
    retryAfterSeconds: z.int().nonnegative().optional(),
    currentRevision: z.int().nonnegative().optional(),
  }),
  requestId: z.string(),
});

export const LiveResponse = z.strictObject({ status: z.literal("ok") });
export const ReadyResponse = z.strictObject({
  status: z.literal("ready"),
  migration: z.int().positive(),
});
export const NotReadyResponse = z.strictObject({ status: z.literal("not_ready") });

export type CurrencyCode = z.infer<typeof CurrencyCode>;
export type MinorAmount = z.infer<typeof MinorAmount>;
export type IsoDate = z.infer<typeof IsoDate>;
export type CatalogueId = z.infer<typeof CatalogueId>;
export type ShortLabel = z.infer<typeof ShortLabel>;
export type NoteText = z.infer<typeof NoteText>;
export type ApiError = z.infer<typeof ApiError>;
export type LiveResponse = z.infer<typeof LiveResponse>;
export type ReadyResponse = z.infer<typeof ReadyResponse>;
export type NotReadyResponse = z.infer<typeof NotReadyResponse>;

export const EmailAddress = z.string().trim().max(254).regex(/^[^@\s]+@[^@\s]+$/u);
export const Password = z.string().transform((value) => value.normalize("NFKC")).superRefine((value, context) => {
  const length = [...value].length;
  if (length < 15 || length > 128) {
    context.addIssue({ code: "custom", message: length < 15 ? "PASSWORD_TOO_SHORT" : "PASSWORD_TOO_LONG" });
  }
});

export const RegisterRequest = z.strictObject({ email: EmailAddress, password: Password });
export const LoginRequest = z.strictObject({ email: EmailAddress, password: z.string() });
export const LogoutRequest = z.strictObject({});
export const OpaqueId = z.string().regex(/^[A-Za-z0-9_-]{22}$/);
export const TripTitle = z.string().trim().pipe(ShortLabel);
export const AccountUser = z.strictObject({ id: OpaqueId, email: EmailAddress, currency: CurrencyCode });
export const SessionResponse = z.strictObject({ user: AccountUser.nullable(), csrfToken: z.string() });
export const AuthResponse = SessionResponse.extend({ user: AccountUser });

export const CreateTripRequest = z.strictObject({
  title: TripTitle.optional(),
  currency: CurrencyCode,
  clientId: z.uuid(),
});
export const BoardResponse = z.strictObject({ revision: z.int().nonnegative() });

export type AccountUser = z.infer<typeof AccountUser>;
export type SessionResponse = z.infer<typeof SessionResponse>;
export type CreateTripRequest = z.infer<typeof CreateTripRequest>;
export type BoardResponse = z.infer<typeof BoardResponse>;

export const MoodId = z.enum(["slow", "food", "culture", "outdoors", "coast"]);

export const Destination = z.union([
  z.strictObject({ placeId: CatalogueId }),
  z.strictObject({ text: ShortLabel }),
]);
export const Duration = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("dates"), start: IsoDate, end: IsoDate }),
  z.strictObject({
    kind: z.literal("count"), amount: z.int().min(1).max(30), unit: z.enum(["days", "nights"]),
  }),
]);
export const Party = z.strictObject({ adults: z.int().min(1).max(30), children: z.int().min(0).max(30) });
export const Budget = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("level"), level: z.enum(["low", "moderate", "high"]), currency: CurrencyCode,
  }),
  z.strictObject({ kind: z.literal("target"), targetMinor: MinorAmount, currency: CurrencyCode }),
]);
export const Pace = z.enum(["relaxed", "balanced", "packed"]);
export const Interests = z.array(ShortLabel).max(8);
export const Constraints = z.array(NoteText).max(8);
const SlotSource = z.enum(["user", "assumed"]);

function slot<T extends z.ZodType>(value: T) {
  return z.strictObject({ value, source: SlotSource }).optional();
}

export const TripBrief = z.strictObject({
  destination: slot(Destination),
  mood: slot(MoodId),
  duration: slot(Duration),
  party: slot(Party),
  budget: slot(Budget),
  pace: slot(Pace),
  interests: slot(Interests),
  constraints: slot(Constraints),
});

export const TripView = z.strictObject({
  id: OpaqueId,
  title: TripTitle,
  currency: CurrencyCode,
  revision: z.int().nonnegative(),
  brief: TripBrief,
  updatedAt: z.iso.datetime(),
});
export const TripResponse = z.strictObject({ trip: TripView });
export const TripListQuery = z.strictObject({
  cursor: z.string().max(256).optional(),
  limit: z.string().regex(/^\d{1,2}$/).transform(Number).pipe(z.int().min(1).max(50)).optional(),
});
export const TripListResponse = z.strictObject({
  items: z.array(TripView.pick({ id: true, title: true, revision: true, updatedAt: true })),
  nextCursor: z.string().optional(),
});

export const StopSpec = z.strictObject({
  ref: z.string().trim().min(1).max(80),
  placeId: CatalogueId.optional(),
  label: ShortLabel,
  period: z.string().min(1).max(24),
  time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(),
  minutes: z.int().min(0).max(1440).optional(),
  transferMinutes: z.int().min(0).max(1440).optional(),
  walkKmEst: z.number().min(0).max(1000).optional(),
  note: NoteText.optional(),
});
export const DaySpec = z.strictObject({
  dayRef: z.string().trim().min(1).max(80),
  ordinal: z.int().min(1).max(30),
  title: ShortLabel,
  date: IsoDate.optional(),
  stops: z.array(StopSpec).max(12),
});
export const CostSpec = z.strictObject({
  dayRef: z.string().trim().min(1).max(80),
  category: z.enum(["stay", "food", "transport", "activity"]),
  amountMinor: MinorAmount,
  currency: CurrencyCode,
});
const CostRow = CostSpec.omit({ currency: true });

const SetSlotOperation = z.discriminatedUnion("slot", [
  z.strictObject({ kind: z.literal("setSlot"), slot: z.literal("destination"), value: Destination }),
  z.strictObject({ kind: z.literal("setSlot"), slot: z.literal("mood"), value: MoodId }),
  z.strictObject({ kind: z.literal("setSlot"), slot: z.literal("duration"), value: Duration }),
  z.strictObject({ kind: z.literal("setSlot"), slot: z.literal("party"), value: Party }),
  z.strictObject({ kind: z.literal("setSlot"), slot: z.literal("budget"), value: Budget }),
  z.strictObject({ kind: z.literal("setSlot"), slot: z.literal("pace"), value: Pace }),
  z.strictObject({ kind: z.literal("setSlot"), slot: z.literal("interests"), value: Interests }),
  z.strictObject({ kind: z.literal("setSlot"), slot: z.literal("constraints"), value: Constraints }),
]);

export const BoardOperation = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("renameTrip"), title: TripTitle }),
  z.strictObject({ kind: z.literal("replaceDays"), days: z.array(DaySpec).max(30) }),
  SetSlotOperation,
  z.strictObject({ kind: z.literal("setCosts"), currency: CurrencyCode, rows: z.array(CostRow) }),
]);
export const BoardRequest = z.strictObject({
  clientId: z.uuid(),
  baseRevision: z.int().nonnegative(),
  ops: z.tuple([BoardOperation], BoardOperation),
});

export type StopSpec = z.infer<typeof StopSpec>;
export type DaySpec = z.infer<typeof DaySpec>;
export type CostSpec = z.infer<typeof CostSpec>;
export type BoardOperation = z.infer<typeof BoardOperation>;

export type PlanDomainFailure =
  | "TOO_MANY_DAYS" | "TOO_MANY_STOPS" | "DUPLICATE_ID" | "OUT_OF_SCOPE"
  | "DUPLICATE_COST" | "PINNED_STOP_REMOVED" | "CURRENCY_MISMATCH" | "UNKNOWN_PLACE" | "INVALID_DATE_SPAN";

type PlanDomainInput = {
  currentDays: readonly DaySpec[];
  proposedDays: readonly DaySpec[];
  allowedDayRefs: readonly string[];
  protectedStops: readonly { dayRef: string; stopRef: string }[];
  costs: readonly CostSpec[];
  currency: CurrencyCode;
  catalogueIds: ReadonlySet<string>;
  dateSpan?: { start: string; end: string };
};

export function validatePlanDomain(input: PlanDomainInput): { ok: true } | { ok: false; code: PlanDomainFailure } {
  if (input.proposedDays.length > 30) return { ok: false, code: "TOO_MANY_DAYS" };
  if (input.proposedDays.some((day) => day.stops.length > 12)) return { ok: false, code: "TOO_MANY_STOPS" };

  const dayRefs = input.proposedDays.map((day) => day.dayRef);
  const stopRefs = input.proposedDays.flatMap((day) => day.stops.map((stop) => stop.ref));
  if (new Set(dayRefs).size !== dayRefs.length || new Set(stopRefs).size !== stopRefs.length) {
    return { ok: false, code: "DUPLICATE_ID" };
  }

  const allowed = new Set(input.allowedDayRefs);
  const currentByRef = new Map(input.currentDays.map((day) => [day.dayRef, day]));
  const proposedByRef = new Map(input.proposedDays.map((day) => [day.dayRef, day]));
  const stableJson = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
    if (value && typeof value === "object") {
      const object = value as Record<string, unknown>;
      return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
  };
  for (const current of input.currentDays) {
    const proposed = proposedByRef.get(current.dayRef);
    if ((!proposed || stableJson(current) !== stableJson(proposed)) && !allowed.has(current.dayRef)) {
      return { ok: false, code: "OUT_OF_SCOPE" };
    }
  }
  for (const proposed of input.proposedDays) {
    if (!currentByRef.has(proposed.dayRef) && !allowed.has(proposed.dayRef)) return { ok: false, code: "OUT_OF_SCOPE" };
  }

  for (const protectedStop of input.protectedStops) {
    if (!proposedByRef.get(protectedStop.dayRef)?.stops.some((stop) => stop.ref === protectedStop.stopRef)) {
      return { ok: false, code: "PINNED_STOP_REMOVED" };
    }
  }
  const costKeys = input.costs.map((cost) => `${cost.dayRef}\u0000${cost.category}`);
  if (new Set(costKeys).size !== costKeys.length) return { ok: false, code: "DUPLICATE_COST" };
  if (input.costs.some((cost) => cost.currency !== input.currency)) return { ok: false, code: "CURRENCY_MISMATCH" };
  if (input.costs.some((cost) => !proposedByRef.has(cost.dayRef))) return { ok: false, code: "OUT_OF_SCOPE" };
  if (input.proposedDays.some((day) => day.stops.some((stop) => stop.placeId && !input.catalogueIds.has(stop.placeId)))) {
    return { ok: false, code: "UNKNOWN_PLACE" };
  }

  if (input.dateSpan) {
    const { start, end } = input.dateSpan;
    if (!IsoDate.safeParse(start).success || !IsoDate.safeParse(end).success || start > end) {
      return { ok: false, code: "INVALID_DATE_SPAN" };
    }
    if (input.proposedDays.some((day) => day.date && (day.date < start || day.date > end))) {
      return { ok: false, code: "INVALID_DATE_SPAN" };
    }
  }
  return { ok: true };
}

const answer = z.literal("answer");
export const TurnAnswer = z.discriminatedUnion("slot", [
  z.strictObject({ kind: answer, slot: z.literal("destination"), value: Destination }),
  z.strictObject({ kind: answer, slot: z.literal("mood"), value: MoodId }),
  z.strictObject({ kind: answer, slot: z.literal("duration"), value: Duration }),
  z.strictObject({ kind: answer, slot: z.literal("party"), value: Party }),
  z.strictObject({ kind: answer, slot: z.literal("budget"), value: Budget }),
  z.strictObject({ kind: answer, slot: z.literal("pace"), value: Pace }),
  z.strictObject({ kind: answer, slot: z.literal("interests"), value: Interests }),
  z.strictObject({ kind: answer, slot: z.literal("constraints"), value: Constraints }),
]);

export const TurnInput = z.union([
  z.strictObject({ kind: z.literal("text"), text: z.string().trim().min(1).max(2000) }),
  TurnAnswer,
  z.strictObject({ kind: z.literal("mood"), moodId: MoodId }),
]);
export const TurnRequest = z.strictObject({
  clientId: z.uuid(),
  baseRevision: z.int().nonnegative(),
  input: TurnInput,
});
export const TurnIntent = z.enum(["intake", "inspire", "draft", "refine", "fit"]);
export const TurnState = z.enum(["active", "committed", "suggested", "conflict", "failed", "cancelled", "interrupted"]);
export const TurnFailure = z.strictObject({
  code: z.string(),
  retryable: z.boolean(),
  retryAfterSeconds: z.int().positive().optional(),
});
export const TurnStatus = z.strictObject({
  turnId: OpaqueId,
  baseRevision: z.int().nonnegative(),
  state: TurnState,
  messageId: OpaqueId.optional(),
  resultRevision: z.int().nonnegative().optional(),
  error: TurnFailure.optional(),
});
export const TurnMessage = z.strictObject({
  id: OpaqueId,
  turnId: OpaqueId.optional(),
  role: z.enum(["user", "assistant"]),
  summary: z.string().min(1).max(2000),
  lang: z.string().max(65536).optional(),
  libraryVersion: ShortLabel,
  createdAt: z.iso.datetime(),
});
export const TurnMessages = z.strictObject({
  items: z.array(TurnMessage),
  nextCursor: z.string().optional(),
});

export type MoodId = z.infer<typeof MoodId>;
export type TripBrief = z.infer<typeof TripBrief>;
export type TripView = z.infer<typeof TripView>;
export type TripListResponse = z.infer<typeof TripListResponse>;
export type BoardRequest = z.infer<typeof BoardRequest>;
export type TurnAnswer = z.infer<typeof TurnAnswer>;
export type TurnInput = z.infer<typeof TurnInput>;
export type TurnRequest = z.infer<typeof TurnRequest>;
export type TurnIntent = z.infer<typeof TurnIntent>;
export type TurnState = z.infer<typeof TurnState>;
export type TurnFailure = z.infer<typeof TurnFailure>;
export type TurnStatus = z.infer<typeof TurnStatus>;
export type TurnMessage = z.infer<typeof TurnMessage>;
export type TurnMessages = z.infer<typeof TurnMessages>;

const SseRevision = z.int().nonnegative();
export const SseEvent = z.discriminatedUnion("event", [
  z.strictObject({
    event: z.literal("accepted"),
    data: z.strictObject({ turnId: OpaqueId, clientId: z.uuid(), baseRevision: SseRevision }),
  }),
  z.strictObject({ event: z.literal("ui.delta"),
    data: z.strictObject({ text: z.string().max(65536).refine((text) => new TextEncoder().encode(text).length <= 65536) }) }),
  z.strictObject({ event: z.literal("ui.reset"), data: z.strictObject({ reason: z.enum(["INVALID_OUTPUT"]) }) }),
  z.strictObject({
    event: z.literal("board.updated"),
    data: z.strictObject({ revision: SseRevision, changedDays: z.array(OpaqueId), removedIds: z.array(OpaqueId) }),
  }),
  z.strictObject({
    event: z.literal("done"),
    data: z.strictObject({ state: TurnState, revision: SseRevision, messageId: OpaqueId.optional() }),
  }),
  z.strictObject({ event: z.literal("error"), data: TurnFailure }),
]);

export type SseEvent = z.infer<typeof SseEvent>;

export const sseHeartbeat = ": hb\n\n";

export function formatSseFrame(seq: number, event: SseEvent): string {
  const id = z.int().nonnegative().parse(seq);
  const checked = SseEvent.parse(event);
  return `id: ${id}\nevent: ${checked.event}\ndata: ${JSON.stringify(checked.data)}\n\n`;
}

export function parseSseFrame(frame: string): { seq: number; event: SseEvent } {
  const fields = /^id: (0|[1-9]\d*)\nevent: ([^\r\n]+)\ndata: ([^\r\n]+)\n\n$/.exec(frame);
  if (!fields || fields[0] !== frame) throw new Error("Invalid SSE frame");
  const [, seq, event, data] = fields;
  return {
    seq: z.int().nonnegative().parse(Number(seq)),
    event: SseEvent.parse({ event, data: JSON.parse(data!) }),
  };
}
