// src/pages/Sales/CallingLists/GiveModal.jsx
//
// One modal for every "who gets it" on a list:
//   count       — give N from the pool to a person (fixed `user`, or picked)   → assign { Assign }
//   contactIds  — give these ticked contacts to a person                        → assign { ContactIds, ToUserId }
//                 (every ticked one a booked callback → setState move instead)
//   addCaller   — put a person on the list's callers                           → saveCallers
// The picker is the leads "Can assign to" list; the server re-checks it (403 sentence shown here).
import { useState } from "react";
import { Box } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { Users } from "lucide-react";

import { AssigneePicker, Button, Modal, TextInput } from "../../../components/ui";
import { CALLING_ENDPOINTS, call } from "../../../api/callingQueries";

export default function GiveModal({ open, onClose, onDone, list, user = null, contactIds = null, moveCallbacks = false, addCaller = false }) {
  const p = useTheme().tokens;
  const [to, setTo] = useState(user?.UserId ?? null);
  const [count, setCount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");

  const byCount = !contactIds && !addCaller;
  const n = Number(count);
  const ready = to && (!byCount || (Number.isInteger(n) && n > 0));

  const submit = async () => {
    setBusy(true); setError("");
    let r;
    if (addCaller) r = await call(CALLING_ENDPOINTS.saveCallers, { CallListId: list.Id, Callers: [{ UserId: to, IsPaused: false }] });
    else if (contactIds && moveCallbacks) r = await call(CALLING_ENDPOINTS.setState, { CallListId: list.Id, ContactIds: contactIds, Action: "move", ToUserId: to });
    else if (contactIds) r = await call(CALLING_ENDPOINTS.assign, { CallListId: list.Id, ContactIds: contactIds, ToUserId: to });
    else r = await call(CALLING_ENDPOINTS.assign, { CallListId: list.Id, Assign: [{ UserId: to, Count: n }] });
    setBusy(false);
    onDone?.();
    if (!r.ok) return setError(r.message);
    setResult(r.message || "Done");
  };

  const title = addCaller ? "Add a caller" : user ? `Give contacts to ${user.FullName}` : contactIds ? `Give ${contactIds.length} contacts to…` : "Give out contacts";
  return (
    <Modal open={open} onClose={onClose} size="sm" data-testid="give-modal">
      <Modal.Header title={title} subtitle={list.Name} icon={<Users size={18} />} onClose={onClose} />
      <Modal.Body>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {!user && <AssigneePicker module="leads" label={addCaller ? "Caller" : "Give to"} value={to} onChange={(id) => setTo(id)} data-testid="give-to" />}
          {byCount && (
            <TextInput label="How many" type="number" value={count} onChange={(e) => setCount(e.target.value)}
              hint="Taken from the front of the pool" data-testid="give-count" />
          )}
          {moveCallbacks && <Box sx={{ fontSize: "calc(13rem / 15)", color: p.text.secondary }}>These are booked callbacks: they move with their callback time.</Box>}
        </Box>
        {error && <Box role="alert" sx={{ mt: 1.5, color: p.error.main, fontSize: "calc(13rem / 15)" }} data-testid="give-error">{error}</Box>}
        {result && <Box role="status" sx={{ mt: 1.5, color: p.text.primary, fontSize: "calc(13rem / 15)" }} data-testid="give-result">{result}</Box>}
      </Modal.Body>
      <Modal.Footer>
        {result ? <Button onClick={onClose} data-testid="give-done">Done</Button> : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={submit} disabled={!ready} loading={busy} data-testid="give-submit">{addCaller ? "Add caller" : "Give"}</Button>
          </>
        )}
      </Modal.Footer>
    </Modal>
  );
}
