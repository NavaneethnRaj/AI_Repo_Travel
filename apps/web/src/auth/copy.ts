export const authCopy = {
  signIn: {
    title: "Welcome back",
    subtitle: "Sign in to resume planning your journeys.",
    submit: "Sign in",
    pending: "Signing in…",
    footer: "New to Wayfarer?",
    link: "Create an account",
    passwordHint: "You can paste or use a password manager.",
  },
  signUp: {
    title: "Create your account",
    subtitle: "Plan thoughtful, day-by-day itineraries with live AI assistance.",
    submit: "Create account",
    pending: "Creating account…",
    footer: "Already have an account?",
    link: "Sign in",
    passwordHint: "Use 15–128 characters. Spaces are welcome. You can paste or use a password manager.",
  },
  emailLabel: "Email address",
  passwordLabel: "Password",
  emailHint: "Enter your email address.",
  capsLock: "Caps Lock is on.",
  checkFields: "Check the highlighted fields.",
  emailRequired: "Please enter your email address.",
  emailInvalid: "Please enter a valid email address.",
  passwordRequired: "Please enter your password.",
  passwordTooShort: "Passwords must be at least 15 characters long.",
  passwordTooLong: "Passwords cannot exceed 128 characters.",
  invalidCredentials: "We couldn't sign you in with that email and password combination. Please check your details and try again.",
  registrationFailed: "We couldn't create your account. Please check your details and try again.",
  sessionExpired: "Your session has expired. Please sign in again to continue.",
  csrfRejected: "Something went wrong while verifying your request. Please refresh the page and try again.",
  serverError: "We ran into an unexpected problem connecting to the server. Please try again in a moment.",
};

export function authRetryMessage(mode: "signin" | "signup", seconds: number): string {
  const wait = Math.max(1, Math.ceil(seconds));
  const [count, unit] = mode === "signup" && wait >= 3600 ? [Math.ceil(wait / 3600), "hour"]
    : wait >= 60 ? [Math.ceil(wait / 60), "minute"] : [wait, "second"];
  const start = mode === "signin"
    ? "Too many sign-in attempts. For your security, please wait"
    : "Too many registration attempts. Please wait";
  return `${start} ${count} ${unit}${count === 1 ? "" : "s"} before trying again.`;
}
