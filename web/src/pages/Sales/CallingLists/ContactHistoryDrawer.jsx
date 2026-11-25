// src/pages/Sales/CallingLists/ContactHistoryDrawer.jsx — one contact's calls, newest first.
import { Box } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { X } from "lucide-react";

import { Chip, Drawer, IconButton } from "../../../components/ui";
import { useApiQuery } from "../../../hooks/useApiQuery";
import { CALLING_ENDPOINTS, CALL_RESULT, CLOSE_REASON, CONTACT_STATUS } from "../../../api/callingQueries";
import { formatDateTime } from "../../../utils/format";

export default function ContactHistoryDrawer({ contactId, onClose }) {
  const p = useTheme().tokens;
  const { data, isLoading, error } = useApiQuery({
    queryKey: ["calling-contact", contactId], endpoint: CALLING_ENDPOINTS.contactHistory, params: { ContactId: contactId },
    enabled: Boolean(contactId), showErrorMessage: false, retry: false,
  });
  const c = data?.contact;
  const attempts = data?.attempts ?? [];
  const st = CONTACT_STATUS[c?.Status];
  const facts = c ? [
    ["Mobile", [c.Mobile, c.AltMobile].filter(Boolean).join(" · ")], ["City", c.City], ["Company", c.Company], ["Address", c.Address],
    ["With", c.HeldByName], ["Attempts", String(c.Attempts ?? 0)],
    // The sheet's own columns, as callingService.withExtras sends them.
    ...(c.extras ?? []).map((x) => [x.label, x.value]),
  ].filter(([, v]) => v) : [];

  return (
    <Drawer open={Boolean(contactId)} onClose={onClose} width={440} data-testid="contact-drawer">
      <Box sx={{ p: 2.5, display: "flex", flexDirection: "column", gap: 2 }}>
        <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
          <Box sx={{ flex: 1 }}>
            <Box sx={{ fontSize: "calc(16rem / 15)", fontWeight: 700 }}>{c?.Name || (isLoading ? "Loading…" : "Contact")}</Box>
            {st && <Box sx={{ mt: 0.5, display: "flex", gap: 0.5 }}>
              <Chip size="sm" tone={st.tone} label={st.label} />
              {c.CloseReason && <Chip size="sm" label={CLOSE_REASON[c.CloseReason] ?? c.CloseReason} />}
            </Box>}
          </Box>
          <IconButton size="sm" variant="ghost" aria-label="Close" onClick={onClose}><X size={16} /></IconButton>
        </Box>
        {error && <Box role="alert" sx={{ color: p.error.main, fontSize: "calc(13rem / 15)" }}>{error.response?.data?.message || "Contact not found"}</Box>}
        {facts.length > 0 && (
          <Box component="dl" sx={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "calc(4rem / 15) calc(12rem / 15)", m: 0, fontSize: "calc(13rem / 15)" }}>
            {facts.map(([k, v]) => [
              <Box component="dt" key={`k-${k}`} sx={{ color: p.text.secondary }}>{k}</Box>,
              <Box component="dd" key={`v-${k}`} sx={{ m: 0 }}>{v}</Box>,
            ])}
          </Box>
        )}
        <Box sx={{ fontWeight: 700, fontSize: "calc(13rem / 15)" }}>Calls</Box>
        {c && !attempts.length && <Box sx={{ color: p.text.secondary, fontSize: "calc(13rem / 15)" }}>Not called yet.</Box>}
        {attempts.map((a) => (
          <Box key={a.Id} data-testid={`attempt-${a.Id}`} sx={{ borderLeft: `3px solid ${p.border.strong}`, pl: 1.5, fontSize: "calc(13rem / 15)" }}>
            <Box sx={{ fontWeight: 600 }}>{CALL_RESULT[a.Result] ?? a.Result}{a.UndoneAt ? " (undone)" : ""}</Box>
            <Box sx={{ color: p.text.secondary }}>
              {[a.UserName, formatDateTime(a.CalledAt), a.DialedAt ? null : "saved without dialling"].filter(Boolean).join(" · ")}
            </Box>
            {a.CallbackAt && <Box sx={{ color: p.text.secondary }}>{`Callback ${formatDateTime(a.CallbackAt)}${a.CallbackOutcome ? ` · ${a.CallbackOutcome}` : ""}`}</Box>}
            {a.Notes && <Box sx={{ mt: 0.5 }}>{a.Notes}</Box>}
          </Box>
        ))}
      </Box>
    </Drawer>
  );
}
