import { ackNotice } from "../../api/presenceQueries";
import useAuthStore from "../../stores/useAuthStore";
import { Dialog } from "../../ui";

// Same wording as the web dialog (notice-text.md); change both together.
const MESSAGE = [
  "Your sign-in and sign-out times, and when the app was last open (every 2 minutes while it is).",
  "Leave and on-duty days your manager marks.",
  "How long assigned tasks take, counted in working hours.",
  "Who sees it: you, your manager and their managers, and admins.",
  "Kept for 13 months.",
  "Not recorded: screenshots, keystrokes, camera, microphone or location.",
]
  .map((line) => `• ${line}`)
  .join("\n");

/** One-time notice after login; OK acknowledges it server-side. */
export default function PresenceNoticeDialog() {
  const visible = useAuthStore((s) => s.isAuthenticated && s.presenceNotice);
  const dismiss = useAuthStore((s) => s.ackPresenceNotice);

  const onOk = () => {
    dismiss();
    ackNotice().catch(() => {}); // ponytail: not retried; the next login re-shows it
  };

  return (
    <Dialog
      visible={visible}
      title="What this workplace records"
      message={MESSAGE}
      confirmLabel="OK"
      hideCancel
      onConfirm={onOk}
      onCancel={onOk}
    />
  );
}
