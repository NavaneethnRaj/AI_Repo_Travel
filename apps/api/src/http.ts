import type { ApiError } from "@wayfarer/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";

export class HttpError extends Error {
  constructor(readonly statusCode: number, readonly detail: ApiError["error"]) {
    super(detail.message);
  }
}

export function problem(statusCode: number, code: string, message: string): never {
  throw new HttpError(statusCode, { code, message });
}

export function input<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const field = issue?.path[0];
  throw new HttpError(issue?.code === "unrecognized_keys" ? 400 : 422, {
    code: issue?.message === "PASSWORD_TOO_SHORT" || issue?.message === "PASSWORD_TOO_LONG" ? issue.message : "INVALID_INPUT",
    message: "Check the submitted fields",
    ...(typeof field === "string" ? { field } : {}),
  });
}

export function respondError(error: HttpError, request: FastifyRequest, reply: FastifyReply) {
  if (error.detail.retryAfterSeconds !== undefined) reply.header("Retry-After", error.detail.retryAfterSeconds);
  const body: ApiError = { error: error.detail, requestId: request.id };
  return reply.code(error.statusCode).send(body);
}
