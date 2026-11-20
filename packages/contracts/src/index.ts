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
