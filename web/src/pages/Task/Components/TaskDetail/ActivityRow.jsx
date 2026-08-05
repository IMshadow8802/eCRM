import dayjs from "dayjs";

import UserAvatar from "../../../../components/ui/UserAvatar";

// One event in the History timeline: avatar + connector rail on the left, then
// who · what on one line, an optional old→new line, and a muted timestamp.
export default function ActivityRow({ activity: a, isLast }) {
  // Only a genuine transition (both sides present) — a bare NewValue just
  // repeats the item text already in the description, so skip it.
  const changed = a.OldValue && a.NewValue && a.OldValue !== a.NewValue;
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "stretch" }}>
      {/* Rail: avatar with a line running down to the next event. */}
      <div
        style={{ display: "flex", flexDirection: "column", alignItems: "center" }}
      >
        <UserAvatar userId={a.UserId} name={a.UserName} size="sm" />
        {!isLast && (
          <div
            style={{
              flex: 1,
              width: 2,
              marginTop: 6,
              borderRadius: 2,
              background: "var(--color-surface-200)",
            }}
          />
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0, paddingBottom: isLast ? 2 : 18 }}>
        {/* One line only — a checklist item can be a whole paragraph; the name
            plus a snippet is enough to tell which event this was. */}
        <div
          style={{
            fontSize: 13,
            lineHeight: 1.4,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={`${a.UserName || "Someone"} ${a.Description || a.Action}`}
        >
          <span style={{ fontWeight: 600 }}>{a.UserName || "Someone"}</span>{" "}
          <span style={{ color: "var(--color-surface-600)" }}>
            {a.Description || a.Action}
          </span>
        </div>
        {changed && (
          <div
            style={{
              fontSize: 12,
              color: "var(--color-surface-500)",
              marginTop: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {a.OldValue ? `${a.OldValue} → ` : ""}
            {a.NewValue}
          </div>
        )}
        <div
          style={{
            fontSize: 11,
            color: "var(--color-surface-400)",
            marginTop: 3,
          }}
        >
          {a.CreatedDate ? dayjs(a.CreatedDate).format("DD/MM/YYYY, hh:mm A") : ""}
        </div>
      </div>
    </div>
  );
}
