import { useTheme } from "@mui/material/styles";
import { motion } from "framer-motion";

/**
 * Progress bar. `value` 0-100. `indeterminate` for unknown progress.
 */
export default function Progress({
  value = 0,
  indeterminate = false,
  tone = "primary",
  size = "md",
  label,
  "data-testid": testId,
}) {
  const theme = useTheme();
  const p = theme.tokens;
  const color = p[tone] ?? p.primary;

  const H = { sm: 4, md: 6, lg: 10 };
  const h = H[size] ?? H.md;
  const pct = Math.min(100, Math.max(0, Number(value) || 0));

  return (
    <div
      data-testid={testId}
      style={{ display: "flex", flexDirection: "column", gap: 4 }}
    >
      {label && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 12,
            fontWeight: 500,
            color: p.text.secondary,
          }}
        >
          <span>{label}</span>
          {!indeterminate && <span>{Math.round(pct)}%</span>}
        </div>
      )}
      <div
        role="progressbar"
        aria-valuenow={indeterminate ? undefined : pct}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{
          width: "100%",
          height: h,
          borderRadius: theme.radii.full,
          backgroundColor:
            p.mode === "dark" ? "rgba(148,163,184,0.12)" : "rgba(148,163,184,0.2)",
          overflow: "hidden",
        }}
      >
        {indeterminate ? (
          <motion.div
            initial={{ x: "-40%" }}
            animate={{ x: "140%" }}
            transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
            style={{
              width: "40%",
              height: "100%",
              borderRadius: theme.radii.full,
              background: color.main,
            }}
          />
        ) : (
          <motion.div
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.32, ease: [0.4, 0, 0.2, 1] }}
            style={{
              height: "100%",
              borderRadius: theme.radii.full,
              background: color.main,
            }}
          />
        )}
      </div>
    </div>
  );
}
