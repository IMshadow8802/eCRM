import { useMemo } from "react";
import { useTheme } from "@mui/material/styles";
import {
  CheckCircle2, CircleDot, Clock, FileText, Flag, Pencil, PhoneCall, PlusCircle, RotateCcw, UserCheck, XCircle,
} from "lucide-react";
import dayjs from "dayjs";

import { EmptyState } from "../../components/ui";

// tblLeadActivity / tblTicketActivity rows expose `Type` and a human-readable
// `Summary`; there is no separate Action/Details column. Spec 2 added
// escalated / rejected / reopened / updated on the complaint side — the map is
// the label AND the icon, so a glance down the rail reads as a story rather
// than as ten identical dots.
const TYPE_META = {
  created: { label: "Created", Icon: PlusCircle, tone: "primary" },
  updated: { label: "Updated", Icon: Pencil, tone: "primary" },
  status: { label: "Status changed", Icon: CircleDot, tone: "info" },
  assigned: { label: "Assigned", Icon: UserCheck, tone: "info" },
  resolved: { label: "Resolved", Icon: CheckCircle2, tone: "success" },
  closed: { label: "Closed", Icon: CheckCircle2, tone: "success" },
  rejected: { label: "Rejected", Icon: XCircle, tone: "error" },
  reopened: { label: "Reopened", Icon: RotateCcw, tone: "warning" },
  escalated: { label: "Escalated", Icon: Flag, tone: "warning" },
  call: { label: "Call", Icon: PhoneCall, tone: "primary" },
  quotation: { label: "Quotation", Icon: FileText, tone: "primary" },
};

const formatType = (type) =>
  String(type || "activity")
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());

// Anything unmapped keeps the old behaviour — the de-underscored type — which
// is what the legacy `stage_changed` / `field_changed` rows still need.
const metaFor = (type) =>
  TYPE_META[String(type || "").toLowerCase()] ?? { label: formatType(type), Icon: Clock, tone: "primary" };

const activityDate = (item) => item.CreatedAt ?? item.CreatedDate ?? null;

const isCall = (item) => String(item?.Type || "").toLowerCase().includes("call");

// Same de-dup rule the component renders with: a real `calls` array replaces
// the activity rows of type 'call' rather than adding to them. Exported so a
// tab badge counts what this component actually shows instead of re-deriving
// (and drifting from) that rule inline.
export const timelineCount = (activity = [], calls = []) =>
  activity.filter((item) => !(calls.length && isCall(item))).length + calls.length;

/**
 * Renders a record's activity trail as a chronological list, oldest first.
 *
 * `calls` is optional and, when given, REPLACES the activity rows of type
 * 'call' rather than adding to them. The two describe the same event at
 * different depths: sp_LogCall writes an activity row saying a call happened
 * ("Outbound call logged"), while tblCall holds what was actually said. Showing
 * both lists every call twice; showing only the activity row loses the notes
 * the user typed.
 */
export default function Timeline({ activity = [], calls = [], outcomes = [] }) {
  const theme = useTheme();
  const p = theme.tokens;

  const sorted = useMemo(() => {
    const outcomeName = (id) => outcomes.find((o) => o.Id === id)?.Value ?? null;

    const fromActivity = activity
      .filter((item) => !(calls.length && isCall(item)))
      .map((item, i) => {
        const meta = metaFor(item.Type);
        return {
          key: `a-${item.Id ?? i}`,
          type: String(item.Type || "activity").toLowerCase(),
          title: meta.label,
          Icon: meta.Icon,
          tone: meta.tone,
          detail: item.Summary,
          at: activityDate(item),
        };
      });

    const fromCalls = calls.map((call) => ({
      key: `c-${call.Id}`,
      type: "call",
      title: call.Direction === "in" ? "Incoming call" : "Outgoing call",
      Icon: PhoneCall,
      tone: "primary",
      detail:
        [call.Notes, outcomeName(call.OutcomeId), call.Duration ? `${call.Duration} min` : null]
          .filter(Boolean)
          .join(" · ") || null,
      at: call.CalledAt ?? call.CreatedAt ?? null,
    }));

    return [...fromActivity, ...fromCalls].sort(
      (a, b) => new Date(a.at ?? 0) - new Date(b.at ?? 0),
    );
  }, [activity, calls, outcomes]);

  if (sorted.length === 0) {
    return (
      <EmptyState
        icon={<Clock size={28} />}
        title="No activity yet"
        description="Calls, status moves, transfers and field changes on this record will show up here."
        size="sm"
        data-testid="timeline-empty"
      />
    );
  }

  const toneOf = (tone) =>
    tone === "default"
      ? { main: p.text.secondary, subtle: p.surface.subtle }
      : { main: p[tone]?.main ?? p.primary.main, subtle: p[tone]?.subtle ?? p.primary.subtle };

  return (
    <div
      data-testid="lead-timeline"
      style={{ display: "flex", flexDirection: "column", gap: 2 }}
    >
      {sorted.map((item) => {
        const t = toneOf(item.tone);
        return (
          <div
            key={item.key}
            data-testid="timeline-item"
            data-type={item.type}
            style={{
              position: "relative",
              display: "flex",
              gap: 12,
              padding: "10px 4px 10px 20px",
              marginLeft: 10,
              borderLeft: `2px solid ${p.border.default}`,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                left: -11,
                top: 10,
                width: 20,
                height: 20,
                borderRadius: theme.radii.full,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: t.subtle,
                color: t.main,
              }}
            >
              <item.Icon size={11} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: p.text.primary }}>
                {item.title}
              </div>
              {item.detail && (
                <div style={{ fontSize: 13, color: p.text.secondary, marginTop: 2 }}>
                  {item.detail}
                </div>
              )}
              <div style={{ fontSize: 11, color: p.text.tertiary, marginTop: 4 }}>
                {item.at ? dayjs(item.at).format("DD-MM-YYYY HH:mm") : ""}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
