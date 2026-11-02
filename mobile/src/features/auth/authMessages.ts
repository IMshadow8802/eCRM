// Wording shared by the login screen and the re-sign-in dialog.

// Fallback only: the 401 normally carries its own message (sessionEndedMessage).
export const REASONS: Record<string, string> = {
  SESSION_EXPIRED: "Your session ended at the end of your shift. Sign in again.",
  SESSION_FORCED: "An admin ended your session.",
};

/** Anything the API didn't explain — network down, DNS, timeout. */
export const FALLBACK_ERROR =
  "Could not reach the server. Check your connection and try again.";

/** The error box in the auth form (E 03): a bold title, an optional line under it. */
export interface AuthError {
  title: string;
  body?: string;
}

export const UNREACHABLE: AuthError = {
  title: "Could not reach the server",
  body: "Check your connection and try again.",
};

/** Codes with E's own wording; every other code keeps the server's text (authController.loginUser). */
export const LOGIN_ERRORS: Record<string, AuthError> = {
  INVALID_CREDENTIALS: {
    title: "Wrong username or password",
    body: "Check both and try again. Your admin can reset the password.",
  },
};

/**
 * A failed login as the box shows it. The server's reply carries
 * `{ code, message }`; with no reply the request never got there.
 */
export function loginError(err: unknown): AuthError {
  const data = (err as { response?: { data?: { code?: string; message?: string } } } | null)?.response?.data;
  if (!data) return UNREACHABLE;
  return LOGIN_ERRORS[data.code ?? ""] ?? (data.message ? { title: data.message } : UNREACHABLE);
}
