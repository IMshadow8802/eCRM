import { Chip } from "../../../../components/ui";

export default function DepSection({
  title,
  items,
  emptyText,
  tone,
  canEdit,
  onRemove,
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          marginBottom: 8,
          color: "var(--color-surface-600)",
        }}
      >
        {title}
      </div>
      {items.length === 0 ? (
        <div
          style={{
            fontSize: 13,
            color: "var(--color-surface-400)",
            fontStyle: "italic",
          }}
        >
          {emptyText}
        </div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {items.map((d) => {
            const done = Boolean(d.IsCompleted);
            return (
              <Chip
                key={d.TaskId}
                label={`${d.Title} — ${done ? "done" : d.ColumnTitle || "open"}`}
                tone={done ? "success" : tone}
                variant="tonal"
                size="md"
                onDelete={canEdit ? () => onRemove?.(d) : undefined}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
