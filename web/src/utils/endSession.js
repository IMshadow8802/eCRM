import { enqueueSnackbar } from "notistack";

import useAuthStore from "../stores/useAuthStore";
import { redirectToLogin } from "./redirectToLogin";

/**
 * Ending the session — once, no matter how many callers ask.
 *
 * There were two ways out of an expired session and they raced each other.
 * The axios interceptors cleared the store and did a hard
 * `window.location.href`; useTokenMonitor cleared it differently and did a
 * soft in-app `navigate('/login')`. Neither knew about the other.
 *
 * That was survivable until a laptop woke from sleep. React Query runs with
 * `refetchOnWindowFocus: true`, so every mounted query refetches in the same
 * instant — and every one of them hit the interceptor, and every one of them
 * ran the whole sequence, assigning `location.href` again. Reassigning it
 * restarts the pending navigation, so a burst of them can keep resetting the
 * very navigation that was about to land, while the monitor's soft navigate
 * fought it and notistack rendered a stack of snackbars. The page sat there
 * churning until it was reloaded by hand.
 *
 * The flag is module-level, so the FIRST caller wins and the rest are no-ops.
 * It is never reset in the app: a hard redirect is about to replace the whole
 * document, and anything still running should stay quiet until it does. Tests
 * reset it explicitly.
 *
 * A hard redirect rather than a router navigate, deliberately. Signing out has
 * to leave nothing behind — caches, timers, sockets, in-flight requests — and
 * throwing the document away is the only way to be sure.
 *
 * @param {string} reason - for the console; not shown to the user.
 * @returns {boolean} true if this call started the teardown, false if one was
 *   already under way. Callers use it to avoid piling on log noise.
 */
let ending = false;

export const isEndingSession = () => ending;

export const endSession = (reason = "Session expired") => {
  if (ending) return false;
  ending = true;

  console.warn(`Ending session: ${reason}`);
  useAuthStore.getState().logout();
  enqueueSnackbar("Session expired. Please login again.", {
    variant: "error",
    autoHideDuration: 3000,
  });
  redirectToLogin();
  return true;
};

/** Test-only. The app never clears this — see above. */
export const resetEndSessionForTests = () => {
  ending = false;
};
