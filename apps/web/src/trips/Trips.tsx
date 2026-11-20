import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, MouseEvent } from "react";
import type { TripListResponse, TripView } from "@wayfarer/contracts";
import type { RequestApi } from "../api.js";
import { ApiFailure } from "../api.js";
import { EmptyTrips } from "./EmptyTrips.js";
import { currencies, suggestedCurrency } from "./currency.js";

export function Trips({
  request, navigateLink, openTrip,
}: {
  request: RequestApi;
  navigateLink: (event: MouseEvent<HTMLAnchorElement>, path: string) => void;
  openTrip: (id: string) => void;
}) {
  const [list, setList] = useState<TripListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [currency, setCurrency] = useState(() => suggestedCurrency(navigator.language));
  const createId = useRef<string | null>(null);
  const pickCurrency = useRef<HTMLSelectElement>(null);

  const load = useCallback(async (cursor?: string) => {
    setLoading(true);
    setError("");
    try {
      const page = await request<TripListResponse>(cursor ? `/trips?cursor=${encodeURIComponent(cursor)}` : "/trips");
      setList((previous) => cursor && previous ? { ...page, items: [...previous.items, ...page.items] } : page);
    } catch {
      setError("We couldn’t load your trips. Try again.");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (creating) pickCurrency.current?.focus(); }, [creating]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    createId.current ??= crypto.randomUUID();
    setSaving(true);
    setError("");
    try {
      const { trip } = await request<{ trip: TripView }>("/trips", {
        method: "POST", body: { currency, clientId: createId.current },
      });
      openTrip(trip.id);
    } catch (failure) {
      if (!(failure instanceof ApiFailure) || failure.status !== 401) {
        setError("We couldn’t start your trip. Try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <main id="main" tabIndex={-1} className="page-content">
      <div className="page-heading">
        <h1>Your trips</h1>
        {!!list?.items.length && !creating && <button type="button" className="primary" onClick={() => setCreating(true)}>Start a trip</button>}
      </div>
      {error && <p role="alert" className="error-summary">{error}</p>}
      {creating && (
        <form className="surface create-trip" onSubmit={create} aria-busy={saving}>
          <h2>Start a trip</h2>
          <label className="field">
            Currency
            <select ref={pickCurrency} value={currency} onChange={(event) => setCurrency(event.target.value)} disabled={saving}>
              {currencies.map((code) => <option key={code} value={code}>{code}</option>)}
            </select>
          </label>
          <div className="actions">
            <button className="primary" type="submit" disabled={saving}>{saving ? "Creating…" : "Create trip"}</button>
            <button type="button" disabled={saving} onClick={() => setCreating(false)}>Cancel</button>
          </div>
        </form>
      )}
      {loading && <p role="status">Loading trips…</p>}
      {!list && error && <button type="button" onClick={() => void load()}>Try again</button>}
      {list?.items.length === 0 && !creating && <EmptyTrips onStart={() => setCreating(true)} />}
      {!!list?.items.length && (
        <ul className="trip-list">
          {list.items.map((trip) => {
            const path = `/trips/${trip.id}`;
            return (
              <li className="surface" key={trip.id}>
                <a href={path} onClick={(event) => navigateLink(event, path)}>
                  <span>{trip.title}</span>
                  <span className="revision">Revision {trip.revision}</span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
      {list?.nextCursor && <button type="button" disabled={loading} onClick={() => void load(list.nextCursor)}>Load more trips</button>}
    </main>
  );
}
