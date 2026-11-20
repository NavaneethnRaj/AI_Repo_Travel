import { TripTitle } from "@wayfarer/contracts";
import type { BoardRequest, BoardResponse, TripView } from "@wayfarer/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ApiFailure } from "../api.js";
import type { RequestApi } from "../api.js";

export function Trip({
  id, request, draft, changeDraft,
}: {
  id: string;
  request: RequestApi;
  draft: string | undefined;
  changeDraft: (value: string | undefined) => void;
}) {
  const [trip, setTrip] = useState<TripView | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const pending = useRef<BoardRequest>(null);
  const path = `/trips/${id}`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await request<{ trip: TripView }>(path);
      setTrip(result.trip);
    } catch (failure) {
      setError(failure instanceof ApiFailure && failure.status === 404
        ? "Trip not found." : "We couldn’t load this trip. Try again.");
    } finally {
      setLoading(false);
    }
  }, [path, request]);

  useEffect(() => { void load(); }, [load]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !trip) return;
    const parsed = TripTitle.safeParse(draft ?? trip.title);
    setMessage("");
    if (!parsed.success) {
      setError("Enter a trip title of 1–80 characters.");
      return;
    }
    setError("");
    setSaving(true);
    const title = parsed.data;
    const saved = pending.current;
    const operation = { kind: "renameTrip", title } as const;
    const body: BoardRequest = saved?.baseRevision === trip.revision && saved.ops[0].title === title
      ? saved : { clientId: crypto.randomUUID(), baseRevision: trip.revision, ops: [operation] };
    pending.current = body;
    try {
      const { revision } = await request<BoardResponse>(`${path}/board`, { method: "PATCH", body });
      pending.current = null;
      setTrip({ ...trip, title, revision });
      changeDraft(undefined);
      setMessage("Saved");
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.status === 409) {
        pending.current = null;
        setError("This trip changed elsewhere. Review your title and save again.");
        await load();
      } else if (failure instanceof ApiFailure && failure.status === 429 && failure.detail?.retryAfterSeconds) {
        const seconds = failure.detail.retryAfterSeconds;
        setError(`Too many changes. Try again in ${seconds} ${seconds === 1 ? "second" : "seconds"}.`);
      } else {
        setError("We couldn’t save this title. Try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <main id="main" tabIndex={-1} className="page-content">
      {loading && <p role="status">Loading trip…</p>}
      {error && <p id="trip-error" role="alert" className="error-summary">{error}</p>}
      {!trip && error && <button type="button" onClick={() => { setError(""); void load(); }}>Try again</button>}
      {trip && (
        <>
          <div className="page-heading">
            <h1>{trip.title}</h1>
            <p className="revision">Revision {trip.revision}</p>
          </div>
          <form className="surface trip-editor" onSubmit={save} aria-busy={saving}>
            <label className="field" htmlFor="trip-title">
              Trip title
              <input
                id="trip-title" value={draft ?? trip.title} onChange={(event) => changeDraft(event.target.value)}
                aria-describedby={error ? "trip-error" : undefined} disabled={saving} maxLength={80}
              />
            </label>
            <div className="actions">
              <button className="primary" type="submit" disabled={saving || loading || draft === undefined || draft === trip.title}>
                {saving ? "Saving…" : "Save title"}
              </button>
              <span role="status">{message}</span>
            </div>
          </form>
        </>
      )}
    </main>
  );
}
