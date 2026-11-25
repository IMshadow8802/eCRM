// src/components/PhoneMarkModal.jsx — mark a number do-not-call or call-with-caution (149).
// `mobile` given = that number; omitted = the admin types one (Do not call page).
// The server's refusal stays in the form. `invalidate` = query keys to refresh after.
import { useState } from "react";
import { useTheme } from "@mui/material/styles";
import { useQueryClient } from "@tanstack/react-query";
import { Ban } from "lucide-react";

import { Button, MobileInput, Modal, RadioGroup, TextArea } from "./ui";
import { PHONE_MARK_ENDPOINTS, call } from "../api/callingQueries";
import { normalizeMobile } from "../utils/mobile";

const MAX_NOTE = 500;
const OPTIONS = [{ value: "dnc", label: "Do not call" }, { value: "caution", label: "Call with caution" }];

export default function PhoneMarkModal({ open, onClose, mobile = null, invalidate = [] }) {
  const p = useTheme().tokens;
  const qc = useQueryClient();
  const [number, setNumber] = useState(mobile ?? "");
  const [mark, setMark] = useState("dnc");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const clean = normalizeMobile(number);
  const ready = clean && note.trim() && note.trim().length <= MAX_NOTE;

  const save = async () => {
    setBusy(true); setError("");
    const r = await call(PHONE_MARK_ENDPOINTS.set, { Mobile: clean, Mark: mark, Note: note.trim() });
    setBusy(false);
    if (!r.ok) return setError(r.message);
    invalidate.forEach((queryKey) => qc.invalidateQueries({ queryKey }));
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} size="sm" data-testid="phone-mark-modal">
      <Modal.Header title={mobile ? `Mark ${mobile}` : "Add a number"} subtitle="The note is required" icon={<Ban size={18} />} onClose={onClose} />
      <Modal.Body>
        <div style={{ display: "flex", flexDirection: "column", gap: "calc(16rem / 15)" }}>
          {!mobile && <MobileInput label="Mobile" required value={number} onChange={setNumber} data-testid="mark-mobile" />}
          <RadioGroup value={mark} onChange={setMark} options={OPTIONS} name="mark" data-testid="mark-kind" />
          <TextArea label="Note" required rows={3} value={note} onChange={(e) => setNote(e.target.value)}
            hint="Shown on the warning everywhere this number appears" error={note.length > MAX_NOTE ? `At most ${MAX_NOTE} characters` : undefined} data-testid="mark-note" />
        </div>
        {error && <div role="alert" style={{ marginTop: "calc(12rem / 15)", color: p.error.main, fontSize: "calc(13rem / 15)" }} data-testid="mark-error">{error}</div>}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant={mark === "dnc" ? "destructive" : "primary"} onClick={save} disabled={!ready} loading={busy} data-testid="mark-save">
          {mark === "dnc" ? "Mark do not call" : "Mark call with caution"}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
