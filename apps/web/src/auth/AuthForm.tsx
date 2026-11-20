import { EmailAddress, Password } from "@wayfarer/contracts";
import { useEffect, useRef, useState } from "react";
import type { FormEvent, MouseEvent } from "react";
import { ApiFailure } from "../api.js";
import { AuthField } from "./Field.js";
import { authCopy, authRetryMessage } from "./copy.js";

export type AuthMode = "signin" | "signup";
type Fields = { email?: string; password?: string };
type Credentials = { email: string; password: string };
type Failure = { message: string; fields: Fields };

function fieldFailure(mode: AuthMode, email: string, password: string): Fields {
  const fields: Fields = {};
  if (!EmailAddress.safeParse(email).success) {
    fields.email = email.trim() ? authCopy.emailInvalid : authCopy.emailRequired;
  }
  if (!password) fields.password = authCopy.passwordRequired;
  else if (mode === "signup") {
    const checked = Password.safeParse(password);
    if (!checked.success) {
      fields.password = checked.error.issues[0]?.message === "PASSWORD_TOO_LONG"
        ? authCopy.passwordTooLong
        : authCopy.passwordTooShort;
    }
  }
  return fields;
}

function failureFor(error: unknown, mode: AuthMode): Failure {
  const fields: Fields = {};
  if (!(error instanceof ApiFailure)) return { message: authCopy.serverError, fields };

  const { status, detail } = error;
  if (status === 429 && typeof detail?.retryAfterSeconds === "number") {
    return { message: authRetryMessage(mode, detail.retryAfterSeconds), fields };
  }
  if (status === 401) return { message: authCopy.invalidCredentials, fields };
  if (status === 403) return { message: authCopy.csrfRejected, fields };
  if (detail?.code === "REGISTRATION_FAILED") return { message: authCopy.registrationFailed, fields };
  if (detail?.field === "email") fields.email = authCopy.emailInvalid;
  if (detail?.field === "password") {
    fields.password = detail.code === "PASSWORD_TOO_LONG"
      ? authCopy.passwordTooLong
      : authCopy.passwordTooShort;
  }
  if (Object.keys(fields).length) return { message: authCopy.checkFields, fields };
  return { message: authCopy.serverError, fields };
}

export function AuthForm({
  mode, notice, onSubmit, onNavigate,
}: {
  mode: AuthMode;
  notice: string | null;
  onSubmit: (credentials: Credentials) => Promise<void>;
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, path: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [capsLock, setCapsLock] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [pending, setPending] = useState(false);
  const summary = useRef<HTMLDivElement>(null);
  const copy = mode === "signin" ? authCopy.signIn : authCopy.signUp;
  const alternate = mode === "signin" ? "/signup" : "/signin";

  useEffect(() => {
    if (failure) summary.current?.focus();
  }, [failure]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const fields = fieldFailure(mode, email, password);
    if (Object.keys(fields).length) {
      setFailure({ message: authCopy.checkFields, fields });
      return;
    }

    setPending(true);
    setFailure(null);
    try {
      await onSubmit({ email, password });
    } catch (error) {
      setFailure(failureFor(error, mode));
    } finally {
      setPending(false);
    }
  }

  return (
    <main id="main" tabIndex={-1} className="auth-page">
      <header className="auth-intro">
        <p className="wordmark">Wayfarer</p>
        <h1>{copy.title}</h1>
        <p>{copy.subtitle}</p>
      </header>
      <div className="auth-card surface">
        {notice && <p role="status" className="notice">{notice}</p>}
        <form noValidate onSubmit={submit} aria-busy={pending}>
          {failure && (
            <div className="error-summary" role="alert" tabIndex={-1} ref={summary}>
              <p>{failure.message}</p>
              {Object.keys(failure.fields).length > 0 && (
                <ul>
                  {Object.entries(failure.fields).map(([name, text]) => <li key={name}>{text}</li>)}
                </ul>
              )}
            </div>
          )}
          <AuthField
            name="email" label={authCopy.emailLabel} type="email" value={email} onChange={setEmail}
            autoComplete="username" hint={authCopy.emailHint} error={failure?.fields.email}
          />
          <AuthField
            name="password" label={authCopy.passwordLabel} type="password" value={password} onChange={setPassword}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            hint={capsLock ? `${copy.passwordHint} ${authCopy.capsLock}` : copy.passwordHint}
            error={failure?.fields.password}
            onKeyEvent={(event) => setCapsLock(event.getModifierState("CapsLock"))}
          />
          <button className="primary" type="submit" disabled={pending}>{pending ? copy.pending : copy.submit}</button>
        </form>
        <p className="auth-footer">{copy.footer} <a href={alternate} onClick={(event) => onNavigate(event, alternate)}>{copy.link}</a></p>
      </div>
    </main>
  );
}
