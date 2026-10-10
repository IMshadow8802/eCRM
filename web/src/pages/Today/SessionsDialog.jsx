import { useState } from "react";
import { MonitorSmartphone } from "lucide-react";

import { Modal, Button, Tooltip } from "../../components/ui";
import { useApiQuery } from "../../hooks/useApiQuery";
import { apiClient } from "../../utils/axiosConfig";
import useAuthStore from "../../stores/useAuthStore";
import { PRESENCE_ENDPOINTS } from "../../api/presenceQueries";
import { istStamp } from "../../utils/tatChip";

// Admin only (the route is requireAdmin; the caller hides the button for everyone else).
export default function SessionsDialog({ open, person, onClose }) {
  const me = useAuthStore((s) => s.user?.UserId ?? s.UserId);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const { data, refetch } = useApiQuery({
    queryKey: ["today", "sessions", person?.UserId],
    endpoint: PRESENCE_ENDPOINTS.fetchSessions,
    params: { UserId: person?.UserId },
    enabled: open && Boolean(person?.UserId),
    staleTime: 0,
  });
  const sessions = data?.sessions ?? [];
  const isSelf = Number(me) === Number(person?.UserId);

  const endAll = async () => {
    setError("");
    try {
      await apiClient.post(PRESENCE_ENDPOINTS.endSession, { UserId: person.UserId });
      setConfirming(false);
      refetch();
    } catch (e) {
      setConfirming(false);
      setError(e?.response?.data?.message || "Could not sign out");
    }
  };

  return (
    <>
      <Modal open={open} onClose={onClose} size="lg" data-testid="sessions-dialog">
        <Modal.Header title="Sign-ins" subtitle={person?.FullName} icon={<MonitorSmartphone size={18} />} onClose={onClose} />
        <Modal.Body>
          {error && <div role="alert">{error}</div>}
          {sessions.length === 0 ? (
            <p>No sign-ins yet.</p>
          ) : (
            <table style={{ width: "100%", fontSize: "calc(13rem / 15)" }}>
              <thead>
                <tr><th align="left">Device</th><th align="left">IP</th><th align="left">Signed in</th><th align="left">Last active</th><th align="left">Signed out</th></tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.SessionId} data-testid={`session-${s.SessionId}`}>
                    <td>{s.Device || "Unknown device"}</td>
                    <td>{s.Ip}</td>
                    <td>{istStamp(s.StartedAt)}</td>
                    <td>{istStamp(s.LastSeenAt)}</td>
                    <td>{s.EndedAt ? `${istStamp(s.EndedAt)}${s.EndReason ? ` (${s.EndReason})` : ""}` : "Active"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Tooltip title={isSelf ? "You cannot sign yourself out here." : "Signs this person out of every phone and computer. They must sign in again. Use it if a phone is lost or shared."}>
            <span>
              <Button variant="primary" disabled={isSelf} onClick={() => setConfirming(true)} data-testid="sessions-end-all">
                Sign out everywhere
              </Button>
            </span>
          </Tooltip>
        </Modal.Footer>
      </Modal>
      <Modal open={confirming} onClose={() => setConfirming(false)} size="sm" data-testid="sessions-confirm">
        <Modal.Header title="Sign out of all devices?" subtitle={`${person?.FullName} will be signed out everywhere.`} onClose={() => setConfirming(false)} />
        <Modal.Footer>
          <Button variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
          <Button variant="primary" onClick={endAll} data-testid="sessions-confirm-end">Sign out everywhere</Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}
