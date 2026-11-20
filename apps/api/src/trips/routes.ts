import { createHash } from "node:crypto";
import { OpaqueId, BoardRequest, CreateTripRequest, TripListQuery } from "@wayfarer/contracts";
import type { BoardResponse, CreateTripRequest as Creation, TripListResponse, TripView } from "@wayfarer/contracts";
import type Database from "better-sqlite3";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { apiPrefix } from "../auth/routes.js";
import type { Rates } from "../auth/rates.js";
import { newId } from "../auth/sessions.js";
import { HttpError, input, problem } from "../http.js";
import { applyBoard } from "./board.js";

type TripRow = Omit<TripView, "brief"> & { brief_json: string };
const cursorValue = z.tuple([z.iso.datetime(), OpaqueId]);

function missingTrip(): never {
  return problem(404, "NOT_FOUND", "Trip not found");
}

function decodeCursor(cursor: string) {
  try {
    const decoded = Buffer.from(cursor, "base64url");
    if (decoded.toString("base64url") === cursor) return cursorValue.parse(JSON.parse(decoded.toString("utf8")));
  } catch {
    // An invalid or obsolete cursor gets the same client error.
  }
  return problem(400, "INVALID_CURSOR", "Invalid trip list cursor");
}

function project({ brief_json, ...trip }: TripRow): TripView {
  return { ...trip, brief: JSON.parse(brief_json) };
}

export function registerTripRoutes(
  app: FastifyInstance, db: Database.Database, clock: () => number, rates: Rates,
  requireUser: (request: FastifyRequest) => string,
) {
  const find = db.prepare<[string, string], TripRow>(`
    SELECT id, title, currency, revision, brief_json, updated_at AS updatedAt FROM trips WHERE owner_id = ? AND id = ?
  `);
  const findCreated = db.prepare<[string, string], TripRow>(`
    SELECT id, title, currency, revision, brief_json, updated_at AS updatedAt FROM trips WHERE owner_id = ? AND client_id = ?
  `);
  const list = db.prepare<[string, string | null, string | null, string | null, number], TripListResponse["items"][number]>(
    `SELECT id, title, revision, updated_at AS updatedAt FROM trips
     WHERE owner_id = ? AND (? IS NULL OR (updated_at, id) < (?, ?))
     ORDER BY updated_at DESC, id DESC LIMIT ?`,
  );
  const insertTrip = db.prepare(`
    INSERT INTO trips (id, owner_id, client_id, title, currency, revision, schema_version, brief_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 0, 1, '{}', ?, ?)
  `);
  const receipt = db.prepare<[string, string, string], { request_hash: Buffer; result_json: string }>(`
    SELECT board_receipts.request_hash, board_receipts.result_json FROM board_receipts
    JOIN trips ON trips.id = board_receipts.trip_id
    WHERE trips.owner_id = ? AND trips.id = ? AND board_receipts.client_id = ?
  `);
  const saveReceipt = db.prepare(`
    INSERT INTO board_receipts (trip_id, client_id, request_hash, result_json, created_at)
    SELECT id, ?, ?, ?, ? FROM trips WHERE owner_id = ? AND id = ?
  `);

  const create = db.transaction((owner: string, body: Creation) => {
    const existing = findCreated.get(owner, body.clientId);
    if (existing) return project(existing);
    const now = new Date(clock()).toISOString();
    const id = newId();
    const title = body.title ?? "Untitled trip";
    insertTrip.run(id, owner, body.clientId, title, body.currency, now, now);
    return { id, title, currency: body.currency, revision: 0, brief: {}, updatedAt: now };
  });

  const board = db.transaction((owner: string, id: string, raw: unknown): BoardResponse => {
    const trip = find.get(owner, id) ?? missingTrip();
    const body = input(BoardRequest, raw);
    const hash = createHash("sha256").update(JSON.stringify(body)).digest();
    const previous = receipt.get(owner, id, body.clientId);
    if (previous) {
      if (!previous.request_hash.equals(hash)) problem(409, "CLIENT_ID_CONFLICT", "This change ID was already used");
      return JSON.parse(previous.result_json);
    }

    if (trip.revision !== body.baseRevision) {
      throw new HttpError(409, {
        code: "STALE_REVISION", message: "The trip changed elsewhere", currentRevision: trip.revision,
      });
    }

    const now = new Date(clock()).toISOString();
    const result = { revision: applyBoard(db, owner, trip, body.ops, now) };
    saveReceipt.run(body.clientId, hash, JSON.stringify(result), now, owner, id);
    return result;
  });

  const prefix = `${apiPrefix}/trips`;
  app.get(prefix, (request) => {
    const owner = requireUser(request);
    const { cursor, limit = 20 } = input(TripListQuery, request.query);
    const [updatedAt, id] = cursor === undefined ? [null, null] : decodeCursor(cursor);
    const rows = list.all(owner, updatedAt, updatedAt, id, limit + 1);
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      items,
      ...(rows.length > limit && last
        ? { nextCursor: Buffer.from(JSON.stringify([last.updatedAt, last.id])).toString("base64url") }
        : {}),
    };
  });

  app.post(prefix, (request, reply) => {
    const owner = requireUser(request);
    return reply.code(201).send({ trip: create.immediate(owner, input(CreateTripRequest, request.body)) });
  });

  function pathId(id: string) {
    return OpaqueId.safeParse(id).success ? id : missingTrip();
  }

  app.get<{ Params: { id: string } }>(`${prefix}/:id`, (request) => {
    const owner = requireUser(request);
    return { trip: project(find.get(owner, pathId(request.params.id)) ?? missingTrip()) };
  });

  app.patch<{ Params: { id: string } }>(`${prefix}/:id/board`, (request) => {
    const owner = requireUser(request);
    const id = pathId(request.params.id);
    rates.take(["board", owner]);
    return board.immediate(owner, id, request.body);
  });
}
