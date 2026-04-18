import { AnimatePresence, motion } from "framer-motion";
import Chip from "./Chip";

/**
 * Animated add/remove of filter chips.
 * Props:
 *   filters: [{ id, label, tone?, onRemove }]
 *   onClear: clears all
 */
export default function FilterChipGroup({
  filters = [],
  onClear,
  "data-testid": testId,
}) {
  if (filters.length === 0) return null;

  return (
    <div
      data-testid={testId}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        flexWrap: "wrap",
      }}
    >
      <AnimatePresence initial={false}>
        {filters.map((f) => (
          <motion.span
            key={f.id}
            layout
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
          >
            <Chip
              label={f.label}
              tone={f.tone ?? "primary"}
              variant="tonal"
              size="sm"
              onDelete={f.onRemove}
              data-testid={testId ? `${testId}-${f.id}` : undefined}
            />
          </motion.span>
        ))}
      </AnimatePresence>
      {filters.length > 1 && onClear && (
        <button
          type="button"
          onClick={onClear}
          data-testid={testId ? `${testId}-clear-all` : undefined}
          style={{
            border: "none",
            background: "transparent",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            color: "inherit",
            opacity: 0.7,
            marginLeft: 4,
          }}
        >
          Clear all
        </button>
      )}
    </div>
  );
}
