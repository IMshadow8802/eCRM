// src/pages/Reports/ClocksDrawer.jsx
import { Link, useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import { useTheme } from "@mui/material/styles";

import Drawer from "../../components/ui/Drawer";
import EmptyState from "../../components/ui/EmptyState";
import IconButton from "../../components/ui/IconButton";
import Skeleton from "../../components/ui/Skeleton";
import { useApiQuery } from "../../hooks/useApiQuery";
import { TEAM_REPORT_ENDPOINTS } from "../../api/reportQueries";
import { istStamp } from "../../utils/tatChip";
import { rowClick } from "../../utils/rowClick";

const CAP = 500; // sp_RptTatClocks returns TOP 500

const VERDICT = { excused: "Excused", not_excused: "Not excused" };
const withRemarks = (text, remarks) => (remarks ? `${text} — ${remarks}` : text);

/**
 * The timers behind one number on the Task deadlines report (spec §2.3).
 * `body` is the report's filter body + `Metric` (+ `GroupKey` for a table row;
 * absent = every group).
 */
export default function ClocksDrawer({ open, title, body, onClose }) {
  const p = useTheme().tokens;
  const navigate = useNavigate();
  const { data, isLoading } = useApiQuery({
    queryKey: ["report", "tatClocks", body],
    endpoint: TEAM_REPORT_ENDPOINTS.tatClocks,
    params: body,
    enabled: Boolean(open && body),
    staleTime: 0,
    showErrorMessage: false,
  });
  const clocks = data?.clocks ?? [];
  const small = { fontSize: "calc(12rem / 15)", color: p.text.secondary };

  return (
    <Drawer open={open} onClose={onClose} width="calc(460rem / 15)" data-testid="clocks-drawer">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "calc(8rem / 15)", padding: "calc(16rem / 15)", borderBottom: `1px solid ${p.border.default}` }}>
        <div style={{ fontWeight: 700, color: p.text.primary }}>{title}</div>
        <IconButton aria-label="Close" onClick={onClose}><X size={18} /></IconButton>
      </div>
      <div style={{ overflowY: "auto", flex: 1 }}>
        {isLoading && <div style={{ padding: "calc(16rem / 15)" }}><Skeleton width="100%" height={80} /></div>}
        {!isLoading && clocks.length === 0 && <EmptyState size="sm" title="No tasks here" />}
        {clocks.length >= CAP && (
          <div style={{ ...small, padding: "calc(8rem / 15) calc(16rem / 15)" }}>Showing the first {CAP}, newest first.</div>
        )}
        {clocks.map((c) => (
          <div key={c.TatId} className="nx-clickable" onClick={rowClick(() => navigate(`/tasks?taskId=${c.TaskId}`))} data-testid={`clock-${c.TatId}`} style={{ padding: "calc(12rem / 15) calc(16rem / 15)", borderBottom: `1px solid ${p.border.default}`, display: "flex", flexDirection: "column", gap: "calc(4rem / 15)" }}>
            <Link to={`/tasks?taskId=${c.TaskId}`} style={{ fontWeight: 600, color: p.text.primary }}>{c.TaskTitle}</Link>
            <div style={small}>{c.FullName} · {c.WorkspaceName}</div>
            <div style={small}>
              Due {istStamp(c.DueAt)} · {c.ClosedAt ? `Finished ${istStamp(c.ClosedAt)}` : "Still open"}
            </div>
            {c.WorkMinutes != null && c.TargetMinutes > 0 && (
              <div style={small}>Used {Math.round((c.WorkMinutes / c.TargetMinutes) * 100)}% of the time allowed</div>
            )}
            {c.BreachedAt && (
              <>
                <div style={{ ...small, color: p.text.primary }}>
                  {c.Reason ? `Reason: ${withRemarks(c.Reason, c.BreachRemarks)}` : "No reason given yet"}
                </div>
                <div style={{ ...small, fontWeight: 600, color: c.Verdict === "not_excused" ? p.error.hover : c.Verdict ? p.text.secondary : p.warning.text }}>
                  {c.Verdict ? withRemarks(`${VERDICT[c.Verdict] ?? c.Verdict} by ${c.VerdictByName}`, c.VerdictRemarks) : "No decision yet"}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </Drawer>
  );
}
