// src/pages/Sales/CallingLists/CallersTab.jsx — who works one list (spec 13.3).
import { useState } from "react";
import { Box } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Undo2, UserMinus, UserPlus } from "lucide-react";

import { Button, Checkbox, Chip, Switch, TextInput } from "../../../components/ui";
import { CALLING_ENDPOINTS, call } from "../../../api/callingQueries";
import GiveModal from "./GiveModal";
import { ActionDialog } from "./ContactsTab";

const num = (v) => Number(v ?? 0).toLocaleString("en-IN");

export default function CallersTab({ list, callers = [], canEdit = false }) {
  const p = useTheme().tokens;
  const qc = useQueryClient();
  const [give, setGive] = useState(null);         // caller row, or "add"
  const [recall, setRecall] = useState(null);     // caller row
  const [withCallbacks, setWithCallbacks] = useState(false);
  const [remove, setRemove] = useState(null);
  const [holds, setHolds] = useState({});
  const [error, setError] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["calling-list"] });

  const saveCaller = async (c, over) => {
    setError("");
    const r = await call(CALLING_ENDPOINTS.saveCallers, { CallListId: list.Id, Callers: [{ UserId: c.UserId, HoldSize: c.HoldSize ?? null, IsPaused: Boolean(c.IsPaused), ...over }] });
    if (!r.ok) setError(r.message);
    refresh();
  };
  const commitHold = (c) => {
    const raw = holds[c.UserId];
    if (raw == null) return;
    const n = raw === "" ? null : Number(raw);
    if (n === (c.HoldSize ?? null)) return;
    if (n != null && !(Number.isInteger(n) && n >= 1 && n <= 200)) return setError("Hold size must be 1 to 200");
    saveCaller(c, { HoldSize: n });
  };

  const cell = { p: "calc(10rem / 15) calc(12rem / 15)", borderBottom: `1px solid ${p.border.subtle}`, textAlign: "left", fontSize: "calc(13rem / 15)" };
  return (
    <Box sx={{ background: p.surface.card, border: `1px solid ${p.border.default}`, borderRadius: "calc(12rem / 15)" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, p: "calc(12rem / 15) calc(16rem / 15)" }}>
        <Box sx={{ flex: 1, fontSize: "calc(13rem / 15)" }}>
          <b>{`${callers.length} callers`}</b>{` · list holds ${list.HoldSize} each · ${num(list.Held)} with callers now`}
        </Box>
        {canEdit && <Button size="sm" variant="tonal" leftIcon={<UserPlus size={14} />} onClick={() => setGive("add")} data-testid="add-caller-btn">Add caller</Button>}
      </Box>
      {error && <Box role="alert" sx={{ px: 2, pb: 1, color: p.error.main, fontSize: "calc(13rem / 15)" }} data-testid="callers-tab-error">{error}</Box>}
      {!callers.length ? (
        <Box sx={{ p: 2, color: p.text.secondary, fontSize: "calc(13rem / 15)" }}>Nobody works this list yet. Give contacts to someone, or add a caller for automatic hand-out.</Box>
      ) : (
        <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", "& th": { ...cell, color: p.text.secondary, fontWeight: 600 }, "& td": cell }}>
          <thead><tr><th>Caller</th><th>Holds at a time</th><th>Holding now</th><th>Callbacks</th><th>Called today</th><th>Leads (list)</th><th>Paused</th>{canEdit && <th />}</tr></thead>
          <tbody>
            {callers.map((c) => (
              <tr key={c.UserId} data-testid={`caller-row-${c.UserId}`}>
                <td><Box sx={{ display: "flex", alignItems: "center", gap: 1, fontWeight: 600 }}>{c.FullName}{c.IsPaused ? <Chip size="sm" label="Paused" /> : null}</Box></td>
                <td>
                  {canEdit ? (
                    <Box sx={{ width: "calc(80rem / 15)" }}>
                      <TextInput size="sm" type="number" placeholder={String(list.HoldSize)} value={holds[c.UserId] ?? (c.HoldSize ?? "")}
                        onChange={(e) => setHolds((h) => ({ ...h, [c.UserId]: e.target.value }))} onBlur={() => commitHold(c)}
                        aria-label={`${c.FullName} holds`} data-testid={`hold-${c.UserId}`} />
                    </Box>
                  ) : (c.HoldSize ?? list.HoldSize)}
                </td>
                <td>{`${num(c.Holding)} / ${c.HoldSize ?? list.HoldSize}`}</td>
                <td>{num(c.Callbacks)}</td>
                <td>{num(c.CalledToday)}</td>
                <td>{num(c.Leads)}</td>
                <td>
                  <Switch size="sm" checked={Boolean(c.IsPaused)} disabled={!canEdit} onChange={() => saveCaller(c, { IsPaused: !c.IsPaused })}
                    aria-label={`Pause ${c.FullName}`} data-testid={`pause-${c.UserId}`} />
                </td>
                {canEdit && (
                  <td>
                    <Box sx={{ display: "flex", gap: 0.5, justifyContent: "flex-end" }}>
                      <Button size="sm" variant="tonal" leftIcon={<Plus size={14} />} onClick={() => setGive(c)} data-testid={`give-caller-${c.UserId}`}>Give</Button>
                      <Button size="sm" variant="ghost" leftIcon={<Undo2 size={14} />} onClick={() => { setWithCallbacks(false); setRecall(c); }} data-testid={`recall-${c.UserId}`}>Pull back all</Button>
                      <Button size="sm" variant="ghost" leftIcon={<UserMinus size={14} />} onClick={() => setRemove(c)} data-testid={`remove-${c.UserId}`}>Remove</Button>
                    </Box>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </Box>
      )}

      {give && <GiveModal open list={list} user={give === "add" ? null : give} addCaller={give === "add"} onClose={() => setGive(null)} onDone={refresh} />}
      {recall && (
        <ActionDialog open title={`Pull back ${recall.FullName}'s contacts?`} confirmText="Pull back" onClose={() => setRecall(null)} onDone={refresh}
          message={`${num(recall.Holding)} contacts they hold go back to the pool.`}
          action={() => call(CALLING_ENDPOINTS.recall, { CallListId: list.Id, FromUserId: recall.UserId, IncludeCallbacks: withCallbacks })}>
          <Box sx={{ mt: 1.5 }}>
            <Checkbox checked={withCallbacks} onChange={(e) => setWithCallbacks(e.target.checked)} label={`Also their ${num(recall.Callbacks)} booked callbacks`} data-testid="recall-callbacks" />
          </Box>
        </ActionDialog>
      )}
      {remove && (
        <ActionDialog open title={`Remove ${remove.FullName} from this list?`} confirmText="Remove" onClose={() => setRemove(null)} onDone={refresh}
          message={`${num(Number(remove.Holding ?? 0) + Number(remove.Callbacks ?? 0))} contacts they hold, callbacks included, go back to the pool.`}
          action={() => call(CALLING_ENDPOINTS.saveCallers, { CallListId: list.Id, Callers: [{ UserId: remove.UserId, Remove: true }] })} />
      )}
    </Box>
  );
}
