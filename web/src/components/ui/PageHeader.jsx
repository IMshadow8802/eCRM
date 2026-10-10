import { useTheme } from "@mui/material/styles";
import { ChevronRight } from "lucide-react";

import { palettes, radii } from "../../styles/tokens";

/**
 * PageHeader — title + subtitle + breadcrumb + actions slot. Top of every page.
 */
export default function PageHeader({
  title,
  titleSuffix,
  subtitle,
  breadcrumb,
  actions,
  icon,
  iconBg,
  iconFg,
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
        gap: "calc(8rem / 15)",
        paddingBottom: "calc(10rem / 15)",
        borderBottom: tabs ? undefined : `1px solid ${p.border.subtle}`,
      }}
    >
      {breadcrumb && breadcrumb.length > 0 && (
        <nav
          aria-label="Breadcrumb"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "calc(6rem / 15)",
            fontSize: "calc(12rem / 15)",
            fontWeight: 500,
            color: p.text.tertiary,
          }}
        >
          {breadcrumb.map((crumb, i) => (
            <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: "calc(6rem / 15)" }}>
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
          gap: "calc(16rem / 15)",
          flexWrap: "wrap",
        }}
      >
        {icon && (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: "calc(44rem / 15)",
              height: "calc(44rem / 15)",
              borderRadius: r.md,
              background: iconBg ?? p.gradient.statAccent,
              color: iconFg ?? "#FFFFFF",
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
              fontSize: "calc(24rem / 15)",
              fontWeight: 700,
              color: p.text.primary,
              letterSpacing: "-0.02em",
              lineHeight: 1.25,
              display: "inline-flex",
              alignItems: "center",
              gap: "calc(10rem / 15)",
              flexWrap: "wrap",
            }}
          >
            {title}
            {titleSuffix}
          </h1>
          {subtitle && (
            <p
              style={{
                margin: "calc(4rem / 15) 0 0",
                fontSize: "calc(14rem / 15)",
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
          // `flexShrink: 0` with no wrap meant a header's buttons could only
          // ever be one unbroken line: the row above lets the block drop under
          // the title, but never breaks it internally, so a detail page's
          // ~570px of actions ran off a 336px screen and `<main>` clipped the
          // primary button away. Wrapping here fixes every page at once; the
          // title block's `flex: 1; minWidth: 0` still keeps actions on their
          // own line wherever there is room.
          <div style={{ display: "flex", gap: "calc(8rem / 15)", flexWrap: "wrap", justifyContent: "flex-end" }}>
            {actions}
          </div>
        )}
      </div>

      {tabs && <div style={{ marginTop: "calc(4rem / 15)" }}>{tabs}</div>}
    </div>
  );
}
