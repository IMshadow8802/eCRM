import { useTheme } from "@mui/material/styles";

/**
 * Animated shimmer skeleton. Set width/height OR use variant="text" to
 * pick sensible defaults.
 */
export default function Skeleton({
  width,
  height,
  variant = "rect",
  rounded,
  style,
  "data-testid": testId,
  ...rest
}) {
  const theme = useTheme();
  const p = theme.tokens;

  let w = width;
  let h = height;
  let radius = rounded ?? theme.radii.sm;

  if (variant === "text") {
    w = width || "100%";
    h = height || 14;
    radius = theme.radii.xs;
  } else if (variant === "circular") {
    w = width || 40;
    h = height || 40;
    radius = theme.radii.full;
  } else if (variant === "button") {
    w = width || 120;
    h = height || 36;
    radius = theme.radii.md;
  }

  return (
    <span
      aria-hidden="true"
      className="shimmer"
      data-testid={testId}
      style={{
        display: "inline-block",
        width: w,
        height: h,
        borderRadius: radius,
        backgroundColor:
          p.mode === "dark" ? "rgba(148,163,184,0.08)" : "rgba(148,163,184,0.18)",
        ...style,
      }}
      {...rest}
    />
  );
}
