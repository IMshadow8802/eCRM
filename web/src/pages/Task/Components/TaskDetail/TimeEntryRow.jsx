import dayjs from "dayjs";
import { Clock, Trash2 } from "lucide-react";

import { IconButton } from "../../../../components/ui";

export default function TimeEntryRow({ entry, canEdit, onDelete }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "calc(10rem / 15)",
        padding: "calc(8rem / 15) calc(12rem / 15)",
        borderRadius: 8,
        border: "1px solid rgba(148,163,184,0.18)",
      }}
    >
      <Clock size={14} style={{ color: "#6366F1" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "calc(13rem / 15)", fontWeight: 600 }}>
          {Number(entry.Hours ?? 0).toFixed(2)} h
          {entry.WorkDate && (
            <span
              style={{
                fontWeight: 400,
                marginLeft: "calc(8rem / 15)",
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
              fontSize: "calc(12rem / 15)",
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
            style={{ fontSize: "calc(11rem / 15)", color: "var(--color-surface-400)", marginTop: 2 }}
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
