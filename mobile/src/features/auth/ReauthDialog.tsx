import { useState } from "react";

import { login as loginRequest } from "../../api/authQueries";
import useAuthStore from "../../stores/useAuthStore";
import { Dialog, Input, Text } from "../../ui";
import { FALLBACK_ERROR, REASONS } from "./LoginScreen";

/**
 * Sign in again over the screen when the server closes the session (shift end,
 * admin end-session). Mirrors web/src/components/ReauthDialog.jsx: the screen
 * underneath stays mounted, so nothing typed is lost, and the requests that hit
 * the 401 retry once this succeeds. It cannot be dismissed — the only ways out
 * are signing in or "Sign in as someone else" (a full logout).
 */
export default function ReauthDialog() {
  const reauth = useAuthStore((s) => s.reauth);
  const username = useAuthStore((s) => s.user?.Username ?? "");
  const resumeSession = useAuthStore((s) => s.resumeSession);
  const logout = useAuthStore((s) => s.logout);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setPassword("");
    setError(null);
  };

  const submit = async () => {
    if (busy) return;
    if (!password) {
      setError("Enter your password.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = await loginRequest({ identifier: username, password });
      if (body.success && body.data) {
        reset();
        resumeSession(body.data);
        return;
      }
      setError(body.message || "Login failed");
    } catch (err: any) {
      // A 401 here is a wrong password: login 401s skip the session path in the client.
      setError(err?.response?.data?.message ?? FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  };

  const signInAsSomeoneElse = () => {
    reset();
    logout();
  };

  const reason = reauth?.message || (reauth && REASONS[reauth.code]) || "Please sign in again.";

  return (
    <Dialog
      visible={Boolean(reauth)}
      title="Sign in again"
      message={reason}
      confirmLabel="Sign in"
      cancelLabel="Sign in as someone else"
      loading={busy}
      dismissable={false}
      onConfirm={submit}
      onCancel={signInAsSomeoneElse}
    >
      <Text variant="secondary">Your work on this screen is kept. Signed in as {username}.</Text>
      <Input
        label="Password"
        accessibilityLabel="Password"
        password
        value={password}
        onChangeText={setPassword}
        error={error}
        autoComplete="current-password"
        autoFocus
        onSubmitEditing={submit}
      />
    </Dialog>
  );
}
