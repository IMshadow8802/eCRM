import useAuthStore from "../stores/useAuthStore";
import { endSession } from "./endSession";

/**
 * Re-sign-in over the page (spec D7, "no lost work").
 *
 * A closed server session 401s with one of these codes. Instead of a hard
 * redirect — which threw away whatever form was half-filled — the app opens
 * ReauthDialog over the page and every request that hit the 401 (or was sent
 * while the dialog is up) waits on ONE shared promise, then retries with the
 * new token. Module-level for the same reason as endSession: a burst of 401s
 * must open exactly one dialog.
 */
export const SESSION_CODES = [
  "SESSION_REQUIRED",
  "SESSION_EXPIRED",
  "SESSION_FORCED",
  "SESSION_ENDED",
];

export const isSessionCode = (code) => SESSION_CODES.includes(code);

// ponytail: a hard endSession elsewhere (JWT expiry, a non-session 401) never
// settles this; harmless because redirectToLogin replaces the whole document.
let pending = null;

export const isReauthOpen = () => pending !== null;

/** @returns {Promise<string>} the new token once the person signs in again. */
export const requestReauth = (code) => {
  if (pending) return pending.promise;
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // A socket-triggered request has no awaiting caller; never surface the
  // cancel as an unhandled rejection. Real callers still see it.
  promise.catch(() => {});
  pending = { promise, resolve, reject };
  const { user, setReauth } = useAuthStore.getState();
  setReauth({ code: isSessionCode(code) ? code : "SESSION_REQUIRED", username: user?.Username ?? "" });
  return promise;
};

const close = () => {
  const p = pending;
  pending = null;
  useAuthStore.getState().setReauth(null);
  return p;
};

export const resolveReauth = (token) => {
  close()?.resolve(token);
};

/** "Sign in as someone else" (or a different person signed in): full teardown. */
export const cancelReauth = () => {
  close()?.reject(new Error("Re-sign-in cancelled"));
  endSession("cancelled re-sign-in", "Signed out. Sign in to continue.");
};

/** Test-only. */
export const resetReauthForTests = () => {
  pending = null;
};
