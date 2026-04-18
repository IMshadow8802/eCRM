import { forwardRef, useId } from "react";
import { motion } from "framer-motion";
import { useTheme } from "@mui/material/styles";

import { motion as motionTokens } from "../../styles/tokens";

/**
 * Animated Checkbox. Custom SVG tick draws in via stroke path animation.
 *
 * Props:
 *   checked, onChange, label, disabled, size sm/md/lg, error
 */

const SIZE = {
  sm: { box: 16, tick: 10 },
  md: { box: 20, tick: 12 },
  lg: { box: 24, tick: 14 },
};

const Checkbox = forwardRef(function Checkbox(
  {
    checked = false,
    onChange,
    label,
    disabled = false,
    size = "md",
    error,
    id: idProp,
    name,
    "data-testid": testId,
    ...rest
  },
  ref,
) {
  const theme = useTheme();
  const p = theme.tokens;
  const s = SIZE[size] ?? SIZE.md;
  const autoId = useId();
  const id = idProp || autoId;
  const hasError = Boolean(error);

  return (
    <label
      htmlFor={id}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        userSelect: "none",
      }}
    >
      <input
        ref={ref}
        id={id}
        name={name}
        type="checkbox"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        data-testid={testId}
        style={{
          position: "absolute",
          opacity: 0,
          width: 0,
          height: 0,
          pointerEvents: "none",
        }}
        {...rest}
      />
      <motion.span
        aria-hidden="true"
        animate={{
          backgroundColor: checked ? p.primary.main : p.surface.card,
          borderColor: hasError
            ? p.error.main
            : checked
              ? p.primary.main
              : p.border.strong,
        }}
        transition={{
          duration: motionTokens.duration.base / 1000,
          ease: [0.4, 0, 0.2, 1],
        }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: s.box,
          height: s.box,
          borderRadius: theme.radii.sm,
          border: "1.5px solid",
          boxSizing: "border-box",
          flexShrink: 0,
        }}
      >
        <svg
          viewBox="0 0 24 24"
          width={s.tick}
          height={s.tick}
          fill="none"
          stroke="white"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ pointerEvents: "none" }}
        >
          <motion.path
            d="M5 12 L10 17 L19 7"
            initial={false}
            animate={{ pathLength: checked ? 1 : 0, opacity: checked ? 1 : 0 }}
            transition={{
              duration: motionTokens.duration.slow / 1000,
              ease: [0.4, 0, 0.2, 1],
            }}
          />
        </svg>
      </motion.span>
      {label && (
        <span
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: hasError ? p.error.main : p.text.primary,
          }}
        >
          {label}
        </span>
      )}
    </label>
  );
});

export default Checkbox;
