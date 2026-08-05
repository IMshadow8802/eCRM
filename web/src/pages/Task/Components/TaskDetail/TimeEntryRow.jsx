import dayjs from "dayjs";
import { Clock, Trash2 } from "lucide-react";

import { IconButton } from "../../../../components/ui";

export default function TimeEntryRow({ entry, canEdit, onDelete }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        borderRadius: 8,
        border: "1px solid rgba(148,163,184,0.18)",
      }}
    >
      <Clock size={14} style={{ color: "#6366F1" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>
          {Number(entry.Hours ?? 0).toFixed(2)} h
          {entry.WorkDate && (
            <span
              style={{
                fontWeight: 400,
                marginLeft: 8,
                color: "var(--color-surface-500)",
              }}
            >
              {dayjs(entry.WorkDate).format("DD-MM-YYYY")}
            </span>
          )}
        </div>
        {entry.Description && (
          <div
            style={{
              fontSize: 12,
              color: "var(--color-surface-500)",
              marginTop: 2,
              wordBreak: "break-word",
            }}
          >
            {entry.Description}
          </div>
        )}
        {entry.UserFullName && (
          <div
            style={{ fontSize: 11, color: "var(--color-surface-400)", marginTop: 2 }}
          >
            {entry.UserFullName}
          </div>
        )}
      </div>
      {canEdit && (
        <IconButton
          size="sm"
          variant="ghost"
          onClick={onDelete}
          aria-label="Delete time entry"
        >
          <Trash2 size={14} />
        </IconButton>
      )}
    </div>
  );
}
