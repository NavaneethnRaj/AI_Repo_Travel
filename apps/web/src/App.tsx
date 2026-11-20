import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import type { SessionResponse } from "@wayfarer/contracts";
import { ApiFailure, fetchApi } from "./api.js";
import type { RequestApi } from "./api.js";
import { AuthForm } from "./auth/AuthForm.js";
import type { AuthMode } from "./auth/AuthForm.js";
import { authCopy } from "./auth/copy.js";
import { Trips } from "./trips/Trips.js";
import { Trip } from "./trips/Trip.js";

function protectedPath(path: string) {
  return path === "/trips" || /^\/trips\/[A-Za-z0-9_-]{22}$/.test(path);
}

export function App() {
  const [path, setPath] = useState(() => window.location.pathname);
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ id: string; value: string } | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const sessionRef = useRef<SessionResponse>(null);
  const returnTo = useRef<string>(null);
  const expiredUser = useRef<string>(null);

  const navigate = useCallback((next: string, replace = false) => {
    if (window.location.pathname !== next) {
      window.history[replace ? "replaceState" : "pushState"](null, "", next);
    }
    setPath(next);
  }, []);

  function navigateLink(event: MouseEvent<HTMLAnchorElement>, next: string) {
    if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      navigate(next);
    }
  }

  const applySession = useCallback((next: SessionResponse | null) => {
    sessionRef.current = next;
    setSession(next);
  }, []);

  const bootstrap = useCallback(async () => {
    setLoadError(false);
    try {
      const next = await fetchApi<SessionResponse>("/session");
      applySession(next);
      return next;
    } catch {
      setLoadError(true);
      return null;
    }
  }, [applySession]);

  useEffect(() => { void bootstrap(); }, [bootstrap]);

  useEffect(() => {
    function backOrForward() { setPath(window.location.pathname); }
    window.addEventListener("popstate", backOrForward);
    return () => window.removeEventListener("popstate", backOrForward);
  }, []);

  useEffect(() => {
    if (!session) return;
    if (!session.user && protectedPath(path)) {
      returnTo.current = path;
      navigate("/signin", true);
    } else if (session.user && !protectedPath(path)) {
      navigate("/trips", true);
    } else if (path === "/") {
      navigate("/signin", true);
    }
  }, [session, path, navigate]);

  const request = useCallback<RequestApi>(async (route, options) => {
    const before = sessionRef.current;
    try {
      return await fetchApi(route, options, before?.csrfToken);
    } catch (error) {
      if (before?.user && sessionRef.current === before && error instanceof ApiFailure
        && (error.status === 401 || (error.status === 403 && error.detail?.code === "CSRF_REJECTED"))) {
        const currentPath = window.location.pathname;
        const refreshed = await bootstrap();
        if (!refreshed?.user && (refreshed || error.status === 401)) {
          expiredUser.current = before.user.id;
          returnTo.current = protectedPath(currentPath) ? currentPath : "/trips";
          setNotice(authCopy.sessionExpired);
          if (!refreshed) applySession(null);
          navigate("/signin", true);
        }
      }
      throw error;
    }
  }, [applySession, bootstrap, navigate]);

  async function authenticate(mode: AuthMode, credentials: { email: string; password: string }) {
    let next: SessionResponse;
    try {
      next = await fetchApi(mode === "signin" ? "/auth/login" : "/auth/register", {
        method: "POST", body: credentials,
      }, sessionRef.current?.csrfToken);
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 403) await bootstrap();
      throw error;
    }

    const sameAccount = !expiredUser.current || expiredUser.current === next.user?.id;
    const destination = sameAccount ? returnTo.current ?? "/trips" : "/trips";
    if (!sameAccount) setDraft(null);
    expiredUser.current = null;
    returnTo.current = null;
    applySession(next);
    setNotice(null);
    navigate(destination, true);
  }

  async function signOut() {
    setSigningOut(true);
    setNotice(null);
    try {
      await request("/auth/logout", { method: "POST", body: {} });
      setDraft(null);
      returnTo.current = null;
      applySession(null);
      navigate("/signin", true);
      await bootstrap();
    } catch {
      if (sessionRef.current?.user) setNotice("We couldn’t sign you out. Try again.");
    } finally {
      setSigningOut(false);
    }
  }

  if (!session) {
    return (
      <main id="main" tabIndex={-1} className="page-content">
        <h1>Wayfarer</h1>
        {loadError ? (
          <>
            <p role="alert" className="error-summary">{authCopy.serverError}</p>
            <button type="button" onClick={() => void bootstrap()}>Try again</button>
          </>
        ) : <p role="status">Loading…</p>}
      </main>
    );
  }

  if (!session.user) {
    const mode = path === "/signup" ? "signup" : "signin";
    return <AuthForm key={mode} mode={mode} notice={notice} onNavigate={navigateLink} onSubmit={(credentials) => authenticate(mode, credentials)} />;
  }

  const id = protectedPath(path) && path !== "/trips" ? path.slice("/trips/".length) : null;

  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="page-bar">
        <a href="/trips" className="wordmark" onClick={(event) => navigateLink(event, "/trips")}>Wayfarer</a>
        {id && <a href="/trips" onClick={(event) => navigateLink(event, "/trips")}>Your trips</a>}
        <button type="button" disabled={signingOut} onClick={() => void signOut()}>{signingOut ? "Signing out…" : "Sign out"}</button>
      </header>
      {notice && <p role="status" className="page-notice">{notice}</p>}
      {id ? (
        <Trip
          key={id} id={id} request={request} draft={draft?.id === id ? draft.value : undefined}
          changeDraft={(value) => setDraft(value === undefined ? null : { id, value })}
        />
      ) : <Trips request={request} navigateLink={navigateLink} openTrip={(tripId) => navigate(`/trips/${tripId}`)} />}
    </>
  );
}
