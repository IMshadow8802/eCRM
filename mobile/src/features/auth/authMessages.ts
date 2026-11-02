// Wording shared by the login screen and the re-sign-in dialog.

// Fallback only: the 401 normally carries its own message (sessionEndedMessage).
export const REASONS: Record<string, string> = {
  SESSION_EXPIRED: "Your session ended at the end of your shift. Sign in again.",
  SESSION_FORCED: "An admin ended your session.",
};

/** Anything the API didn't explain — network down, DNS, timeout. */
export const FALLBACK_ERROR =
  "Could not reach the server. Check your connection and try again.";
