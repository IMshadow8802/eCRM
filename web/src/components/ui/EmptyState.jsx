import { useTheme } from "@mui/material/styles";

/**
 * EmptyState — abstract gradient blob background + icon + title + subtitle + CTA.
 */
export default function EmptyState({
  icon,
  title,
  description,
  action,
  size = "md",
  "data-testid": testId,
}) {
  const theme = useTheme();
  const p = theme.tokens;

  const SIZE = {
    sm: { w: 80, iw: 28, titleFz: 15, descFz: 13 },
    md: { w: 120, iw: 36, titleFz: 18, descFz: 14 },
    lg: { w: 160, iw: 48, titleFz: 22, descFz: 15 },
  };
  const s = SIZE[size] ?? SIZE.md;

  return (
    <div
      data-testid={testId}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: 32,
        gap: 16,
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "relative",
          width: s.w,
          height: s.w,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: theme.radii.full,
            background: p.gradient.emptyBlob,
            filter: "blur(6px)",
          }}
        />
        {icon && (
          <div
            style={{
              position: "relative",
              color: p.primary.main,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: s.iw * 1.4,
              height: s.iw * 1.4,
              borderRadius: theme.radii.full,
              backgroundColor: p.surface.card,
              border: `1px solid ${p.border.default}`,
              boxShadow: p.shadow.sm,
            }}
          >
            {icon}
          </div>
        )}
      </div>
      {title && (
        <h3
          style={{
            margin: 0,
            fontSize: s.titleFz,
            fontWeight: 700,
            color: p.text.primary,
            letterSpacing: "-0.01em",
          }}
        >
          {title}
        </h3>
      )}
      {description && (
        <p
          style={{
            margin: 0,
            maxWidth: 420,
            fontSize: s.descFz,
            color: p.text.secondary,
            lineHeight: 1.5,
          }}
        >
          {description}
        </p>
      )}
      {action && <div>{action}</div>}
    </div>
  );
}
