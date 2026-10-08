import { useState } from "react";

import { Modal, Button } from "./ui";
import useAuthStore from "../stores/useAuthStore";
import { ackNotice } from "../api/presenceQueries";

// Exact copy (spec P2 notice): what is recorded, who sees it, how long, and
// what is NOT collected. Change it only with the spec.
const POINTS = [
  "Your sign-in and sign-out times, and when the app was last open (every 2 minutes while it is).",
  "Leave and on-duty days your manager marks.",
  "How long assigned tasks take, counted in working hours.",
  "Who sees it: you, your manager and their managers, and admins.",
  "Kept for 13 months.",
  "Not recorded: screenshots, keystrokes, camera, microphone or location.",
];

/** Shown once, at the first sign-in after go-live (login's `presenceNotice`). */
export default function PresenceNoticeDialog() {
  const open = useAuthStore((s) => Boolean(s.presenceNotice));
  const [busy, setBusy] = useState(false);

  const acknowledge = async () => {
    setBusy(true);
    try {
      await ackNotice();
    } catch {
      // ponytail: unacked = the server shows it again next sign-in; no retry UI
    } finally {
      setBusy(false);
      useAuthStore.getState().setPresenceNotice(false);
    }
  };

  return (
    <Modal
      open={open}
      size="sm"
      dismissOnBackdrop={false}
      dismissOnEscape={false}
      data-testid="presence-notice"
      aria-label="What this workplace records"
    >
      <Modal.Header title="What this workplace records" />
      <Modal.Body>
        <ul style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8 }}>
          {POINTS.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </Modal.Body>
      <Modal.Footer>
        <Button onClick={acknowledge} loading={busy}>
          OK
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
