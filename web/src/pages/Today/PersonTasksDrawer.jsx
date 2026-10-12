import { Link, useNavigate } from "react-router-dom";
import { AlertCircle, X } from "lucide-react";
import { useTheme } from "@mui/material/styles";

import Drawer from "../../components/ui/Drawer";
import Button from "../../components/ui/Button";
import Chip from "../../components/ui/Chip";
import EmptyState from "../../components/ui/EmptyState";
import IconButton from "../../components/ui/IconButton";
import { useApiQuery } from "../../hooks/useApiQuery";
import { TODAY } from "../../api/todayQueries";
import { numberLabel, taskChip } from "./todayWords";
import { rowClick } from "../../utils/rowClick";

const TONE = { red: "error", amber: "warning", blue: "info", green: "success", grey: "default" };

/** One person's tasks in one Today bucket (spec §2.2). */
export default function PersonTasksDrawer({ open, userId, name, workDate, bucket, live = true, onClose }) {
  const p = useTheme().tokens;
  const navigate = useNavigate();
  const { data, isLoading, isError, refetch } = useApiQuery({
    queryKey: ["today", "personTasks", userId, bucket, workDate],
    endpoint: TODAY.personTasks,
    params: { UserId: userId, Bucket: bucket, ...(workDate ? { WorkDate: workDate } : {}) },
    enabled: Boolean(open && userId && bucket),
    staleTime: 0,
  });
  const tasks = data?.tasks ?? [];

  return (
    <Drawer open={open} onClose={onClose} width="calc(440rem / 15)" data-testid="person-tasks-drawer">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "calc(16rem / 15)", borderBottom: `1px solid ${p.border.default}` }}>
        <div>
          <div style={{ fontWeight: 700, color: p.text.primary }}>{name}</div>
          <div style={{ fontSize: "calc(13rem / 15)", color: p.text.secondary }}>{numberLabel(bucket, live) ?? bucket}</div>
        </div>
        <IconButton aria-label="Close" onClick={onClose}><X size={18} /></IconButton>
      </div>
      <div style={{ overflowY: "auto", flex: 1 }}>
        {isError ? (
          <EmptyState size="sm" icon={<AlertCircle />} title="Couldn't load these tasks" action={<Button onClick={() => refetch()}>Retry</Button>} />
        ) : !isLoading && tasks.length === 0 && <EmptyState size="sm" title="Nothing here" />}
        {tasks.map((t) => {
          const chip = taskChip(t);
          return (
            <div key={t.TaskId} className="nx-clickable" onClick={rowClick(() => navigate(`/tasks?taskId=${t.TaskId}`))} data-testid={`drawer-task-${t.TaskId}`} style={{ padding: "calc(12rem / 15) calc(16rem / 15)", borderBottom: `1px solid ${p.border.default}`, display: "flex", flexDirection: "column", gap: "calc(6rem / 15)" }}>
              <Link to={`/tasks?taskId=${t.TaskId}`} style={{ fontWeight: 600, color: p.text.primary }}>{t.Title}</Link>
              <div style={{ display: "flex", alignItems: "center", gap: "calc(8rem / 15)", flexWrap: "wrap", fontSize: "calc(12rem / 15)", color: p.text.secondary }}>
                <span>{t.WorkspaceName}</span>
                <Chip size="sm" label={chip.label} tone={TONE[chip.tone]} />
                {t.StepsTotal > 0 && <span>{t.StepsDone} of {t.StepsTotal}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </Drawer>
  );
}
