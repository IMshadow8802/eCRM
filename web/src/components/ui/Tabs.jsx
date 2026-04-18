import { motion } from "framer-motion";
import { useTheme } from "@mui/material/styles";

import { motion as motionTokens } from "../../styles/tokens";

/**
 * Animated underline tabs. Indicator slides between active items.
 */
export default function Tabs({
  value,
  onChange,
  items = [],
  size = "md",
  "data-testid": testId,
}) {
  const theme = useTheme();
  const p = theme.tokens;

  const SIZE = {
    sm: { h: 36, fz: 13, px: 12 },
    md: { h: 44, fz: 14, px: 16 },
    lg: { h: 52, fz: 15, px: 20 },
  };
  const s = SIZE[size] ?? SIZE.md;

  return (
    <div
      role="tablist"
      data-testid={testId}
      style={{
        display: "inline-flex",
        borderBottom: `1px solid ${p.border.default}`,
        gap: 4,
      }}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={item.panelId}
            onClick={() => onChange?.(item.value)}
            data-testid={testId ? `${testId}-${item.value}` : undefined}
            style={{
              position: "relative",
              minHeight: s.h,
              paddingInline: s.px,
              border: "none",
              background: "transparent",
              fontSize: s.fz,
              fontWeight: 600,
              fontFamily: "inherit",
              color: active ? p.primary.main : p.text.secondary,
              cursor: "pointer",
              outline: "none",
              transition: `color ${motionTokens.duration.base}ms ${motionTokens.easing.standard}`,
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {item.icon && <span style={{ display: "inline-flex" }}>{item.icon}</span>}
              {item.label}
              {item.badge != null && (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: "2px 6px",
                    borderRadius: theme.radii.full,
                    backgroundColor: active ? p.primary.subtle : p.surface.subtle,
                    color: active ? p.primary.main : p.text.secondary,
                  }}
                >
                  {item.badge}
                </span>
              )}
            </span>
            {active && (
              <motion.span
                layoutId={`tab-indicator-${testId || "t"}`}
                transition={{
                  duration: motionTokens.duration.base / 1000,
                  ease: [0.2, 0, 0, 1],
                }}
                style={{
                  position: "absolute",
                  left: 8,
                  right: 8,
                  bottom: -1,
                  height: 3,
                  borderRadius: theme.radii.full,
                  backgroundColor: p.primary.main,
                }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
