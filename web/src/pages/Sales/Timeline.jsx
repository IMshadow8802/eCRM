import { useTheme } from "@mui/material/styles";
import { Clock } from "lucide-react";
import dayjs from "dayjs";

import { EmptyState } from "../../components/ui";

const formatAction = (action) =>
  String(action || "activity")
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());

const activityDate = (item) => item.CreatedAt ?? item.CreatedDate ?? null;

/**
 * Renders a lead's activity trail (from `fetchLeadDetail`'s `activity`
 * recordset) as a chronological list, oldest first.
 */
export default function Timeline({ activity = [] }) {
  const theme = useTheme();
  const p = theme.tokens;

  const sorted = [...activity].sort(
    (a, b) => new Date(activityDate(a) ?? 0) - new Date(activityDate(b) ?? 0),
  );

  if (sorted.length === 0) {
    return (
      <EmptyState
        icon={<Clock size={28} />}
        title="No activity yet"
        description="Calls, stage moves, and field changes on this lead will show up here."
        size="sm"
        data-testid="timeline-empty"
      />
    );
  }

  return (
    <div
      data-testid="lead-timeline"
      style={{ display: "flex", flexDirection: "column", gap: 2 }}
    >
      {sorted.map((item, i) => {
        const when = activityDate(item);
        const detail = item.Details || item.Description || item.Notes;
        return (
          <div
            key={item.Id ?? i}
            data-testid="timeline-item"
            style={{
              position: "relative",
              display: "flex",
              gap: 12,
              padding: "10px 4px 10px 16px",
              marginLeft: 6,
              borderLeft: `2px solid ${p.border.default}`,
            }}
          >
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                left: -5,
                top: 14,
                width: 8,
                height: 8,
                borderRadius: theme.radii.full,
                backgroundColor: p.primary.main,
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: p.text.primary }}>
                {formatAction(item.Action)}
              </div>
              {detail && (
                <div style={{ fontSize: 13, color: p.text.secondary, marginTop: 2 }}>
                  {detail}
                </div>
              )}
              <div style={{ fontSize: 11, color: p.text.tertiary, marginTop: 4 }}>
                {when ? dayjs(when).format("DD-MM-YYYY HH:mm") : ""}
                {item.UserName ? ` · ${item.UserName}` : ""}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
