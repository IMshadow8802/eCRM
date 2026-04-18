import { useTheme } from "@mui/material/styles";
import { ChevronRight } from "lucide-react";

import { palettes, radii } from "../../styles/tokens";

/**
 * PageHeader — title + subtitle + breadcrumb + actions slot. Top of every page.
 */
export default function PageHeader({
  title,
  subtitle,
  breadcrumb,
  actions,
  icon,
  tabs,
  "data-testid": testId,
}) {
  const theme = useTheme();
  const p = theme.tokens ?? palettes.light;
  const r = theme.radii ?? radii;

  return (
    <div
      data-testid={testId}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        paddingBottom: 16,
        borderBottom: tabs ? undefined : `1px solid ${p.border.subtle}`,
      }}
    >
      {breadcrumb && breadcrumb.length > 0 && (
        <nav
          aria-label="Breadcrumb"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            fontWeight: 500,
            color: p.text.tertiary,
          }}
        >
          {breadcrumb.map((crumb, i) => (
            <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {crumb.href ? (
                <a
                  href={crumb.href}
                  style={{ color: p.text.secondary, textDecoration: "none" }}
                >
                  {crumb.label}
                </a>
              ) : (
                <span>{crumb.label}</span>
              )}
              {i < breadcrumb.length - 1 && <ChevronRight size={12} />}
            </span>
          ))}
        </nav>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        {icon && (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 44,
              height: 44,
              borderRadius: r.md,
              background: p.gradient.statAccent,
              color: "#FFFFFF",
              flexShrink: 0,
            }}
          >
            {icon}
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1
            style={{
              margin: 0,
              fontSize: 24,
              fontWeight: 700,
              color: p.text.primary,
              letterSpacing: "-0.02em",
              lineHeight: 1.25,
            }}
          >
            {title}
          </h1>
          {subtitle && (
            <p
              style={{
                margin: "4px 0 0",
                fontSize: 14,
                fontWeight: 500,
                color: p.text.secondary,
                lineHeight: 1.5,
              }}
            >
              {subtitle}
            </p>
          )}
        </div>
        {actions && (
          <div style={{ display: "inline-flex", gap: 8, flexShrink: 0 }}>
            {actions}
          </div>
        )}
      </div>

      {tabs && <div style={{ marginTop: 4 }}>{tabs}</div>}
    </div>
  );
}
