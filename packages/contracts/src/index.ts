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
export const TripView = z.strictObject({
  id: OpaqueId,
  title: TripTitle,
  currency: CurrencyCode,
  revision: z.int().nonnegative(),
  brief: z.strictObject({}),
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
const BoardOperation = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("renameTrip"), title: TripTitle }),
]);
export const BoardRequest = z.strictObject({
  clientId: z.uuid(),
  baseRevision: z.int().nonnegative(),
  ops: z.tuple([BoardOperation], BoardOperation),
});
export const BoardResponse = z.strictObject({ revision: z.int().nonnegative() });

export type AccountUser = z.infer<typeof AccountUser>;
export type SessionResponse = z.infer<typeof SessionResponse>;
export type CreateTripRequest = z.infer<typeof CreateTripRequest>;
export type TripView = z.infer<typeof TripView>;
export type TripListResponse = z.infer<typeof TripListResponse>;
export type BoardRequest = z.infer<typeof BoardRequest>;
export type BoardResponse = z.infer<typeof BoardResponse>;
