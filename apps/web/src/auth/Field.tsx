import type { KeyboardEvent } from "react";

export interface AuthFieldProps {
  name: "email" | "password";
  label: string;
  type: "email" | "password";
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  hint?: string;
  error?: string;
  onKeyEvent?: (event: KeyboardEvent<HTMLInputElement>) => void;
}

export function AuthField({
  name,
  label,
  type,
  value,
  onChange,
  autoComplete,
  hint,
  error,
  onKeyEvent,
}: AuthFieldProps) {
  const inputId = `auth-${name}`;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;

  const describedBy = [
    error ? errorId : null,
    hint ? hintId : null,
  ]
    .filter(Boolean)
    .join(" ") || undefined;

  return (
    <div className="field">
      <label htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        name={name}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyEvent}
        onKeyUp={onKeyEvent}
        autoComplete={autoComplete}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
      />
      {hint && (
        <p id={hintId} className="field-hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
