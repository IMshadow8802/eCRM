import { forwardRef, useId } from "react";
import { motion } from "framer-motion";
import { useTheme } from "@mui/material/styles";

import { motion as motionTokens } from "../../styles/tokens";

const SIZE = {
  sm: { w: 32, h: 18, thumb: 14 },
  md: { w: 40, h: 22, thumb: 18 },
  lg: { w: 48, h: 26, thumb: 22 },
};

const Switch = forwardRef(function Switch(
  {
    checked = false,
    onChange,
    label,
    disabled = false,
    size = "md",
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
  const thumbOffset = s.w - s.thumb - 4;

  return (
    <label
      htmlFor={id}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
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
        role="switch"
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
          backgroundColor: checked
            ? p.primary.main
            : p.mode === "dark"
              ? "#334155"
              : "#CBD5E1",
        }}
        transition={{
          duration: motionTokens.duration.base / 1000,
          ease: [0.4, 0, 0.2, 1],
        }}
        style={{
          position: "relative",
          width: s.w,
          height: s.h,
          borderRadius: theme.radii.full,
          display: "inline-block",
          flexShrink: 0,
        }}
      >
        <motion.span
          aria-hidden="true"
          animate={{ x: checked ? thumbOffset : 2 }}
          transition={{
            duration: motionTokens.duration.base / 1000,
            ease: [0.4, 0, 0.2, 1],
          }}
          style={{
            position: "absolute",
            top: (s.h - s.thumb) / 2,
            left: 0,
            width: s.thumb,
            height: s.thumb,
            borderRadius: theme.radii.full,
            background: "#FFFFFF",
            boxShadow: p.shadow.sm,
          }}
        />
      </motion.span>
      {label && (
        <span style={{ fontSize: 14, fontWeight: 500, color: p.text.primary }}>
          {label}
        </span>
      )}
    </label>
  );
});

export default Switch;
