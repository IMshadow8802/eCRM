import { useState } from "react";

import { Modal, Button, TextInput } from "./ui";
import useAuthStore from "../stores/useAuthStore";
import { loginUser } from "../api/platformQueries";
import { cancelReauth, resolveReauth } from "../utils/reauth";

const TITLES = {
  SESSION_EXPIRED: "Your shift session ended",
  SESSION_FORCED: "An admin ended your session",
};

/**
 * Sign-in-again box over the page (spec D7). Opened by utils/reauth when a
 * closed session 401s; the page underneath stays mounted, so nothing typed is
 * lost, and the waiting requests retry once this resolves. It cannot be
 * dismissed — the only ways out are signing in or "Sign in as someone else".
 */
export default function ReauthDialog() {
  const reauth = useAuthStore((s) => s.reauth);
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (!password) {
      setError("Enter your password.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data: body } = await loginUser({
        identifier: reauth.username,
        password,
        Device: "web",
      });
      const data = body?.data;
      if (!body?.success || !data?.token) {
        setError(body?.message || "Could not sign in. Try again.");
        return;
      }
      setPassword("");
      // A different person must not inherit this page or its queued requests.
      if (Number(data.user?.Id) !== Number(useAuthStore.getState().UserId)) {
        cancelReauth();
        return;
      }
      useAuthStore.getState().login(data);
      resolveReauth(data.token);
    } catch (err) {
      setError(err.response?.data?.message || "Could not sign in. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={Boolean(reauth)}
      size="sm"
      dismissOnBackdrop={false}
      dismissOnEscape={false}
      data-testid="reauth-dialog"
      aria-label="Sign in again"
    >
      <Modal.Header
        title={TITLES[reauth?.code] ?? "Please sign in again"}
        subtitle="Your work on this page is kept."
      />
      <form onSubmit={submit} noValidate>
        <Modal.Body>
          <div style={{ display: "flex", flexDirection: "column", gap: "calc(12rem / 15)" }}>
            <TextInput label="Username" value={reauth?.username ?? ""} readOnly />
            <TextInput
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={error}
              autoComplete="current-password"
              autoFocus
            />
          </div>
        </Modal.Body>
        <Modal.Footer align="between">
          <Button variant="ghost" onClick={cancelReauth} disabled={busy}>
            Sign in as someone else
          </Button>
          <Button type="submit" loading={busy}>
            Sign in
          </Button>
        </Modal.Footer>
      </form>
    </Modal>
  );
}
