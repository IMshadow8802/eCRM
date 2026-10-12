import { useState } from "react";
import { createPortal } from "react-dom";
import { Box, Popover, useMediaQuery } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { ChevronRight, MoreHorizontal } from "lucide-react";

import IconButton from "./IconButton";

import { palettes } from "../../styles/tokens";
import { useHeaderSlot } from "./headerSlot";

/**
 * PageHeader — the page's title line: breadcrumb › title (+ suffix), a muted
 * subtitle, and the page's actions.
 *
 * Inside RootLayout it renders INTO the top bar (see headerSlot), so a page
 * spends no vertical space on a header block under the bar repeating its
 * title. Rendered alone it draws the same line inline, one compact row.
 * `tabs` stay in the page body: they switch content, so they belong next to it.
 *
 * `icon` is drawn as a small glyph before the title (it can carry meaning:
 * the task board's workspace type). The 44px tinted tile it used to sit in
 * is gone: the glyph takes the tile's colour (`iconBg`, when it is a plain
 * colour) on the bar's white, and `iconFg` — the glyph colour ON the tile,
 * usually white — is ignored.
 */
export default function PageHeader({
  title,
  titleSuffix,
  subtitle,
  breadcrumb,
  actions,
  icon,
  iconBg,
  tabs,
  "data-testid": testId,
}) {
  const theme = useTheme();
  const p = theme.tokens ?? palettes.light;
  const { slot } = useHeaderSlot();
  // On a phone the actions fold behind one "more" button: row 2 keeps the
  // title, nothing runs off the screen.
  const phone = useMediaQuery("(max-width:767.98px)");
  const [moreAnchor, setMoreAnchor] = useState(null);
  // Picking an action closes the menu; opening a picker inside it does not.
  const closeOnAction = (e) => {
    const btn = e.target.closest?.("button");
    if (btn && !btn.closest(".MuiAutocomplete-root, .MuiPickersInputBase-root")) setMoreAnchor(null);
  };

  const line = (
    <Box
      data-testid={testId}
      data-page-header={slot ? "bar" : "inline"}
      sx={{
        display: "flex",
        alignItems: "center",
        columnGap: "calc(12rem / 15)",
        rowGap: "calc(6rem / 15)",
        flexWrap: "wrap",
        flex: 1,
        minWidth: 0,
        minHeight: "calc(36rem / 15)",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", columnGap: "calc(10rem / 15)", flexWrap: "wrap", flex: "1 1 auto", minWidth: 0 }}>
        {breadcrumb?.length > 0 && (
          <nav
            aria-label="Breadcrumb"
            style={{ display: "inline-flex", alignItems: "center", gap: "calc(4rem / 15)", fontSize: "calc(13rem / 15)", fontWeight: 500, color: p.text.tertiary }}
          >
            {breadcrumb.map((crumb, i) => (
              <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: "calc(4rem / 15)" }}>
                {crumb.href ? (
                  <a href={crumb.href} style={{ color: p.text.secondary, textDecoration: "none" }}>{crumb.label}</a>
                ) : (
                  <span>{crumb.label}</span>
                )}
                <ChevronRight size={12} aria-hidden />
              </span>
            ))}
          </nav>
        )}
        {icon && (
          <Box
            component="span"
            aria-hidden
            sx={{ display: "inline-flex", color: iconBg && !String(iconBg).includes("gradient") ? iconBg : p.primary.main, flexShrink: 0, "& svg": { width: "calc(18rem / 15)", height: "calc(18rem / 15)" } }}
          >
            {icon}
          </Box>
        )}
        <h1
          style={{
            margin: 0,
            fontSize: "calc(16rem / 15)",
            fontWeight: 600,
            color: p.text.primary,
            letterSpacing: "-0.01em",
            lineHeight: 1.3,
            display: "inline-flex",
            alignItems: "center",
            gap: "calc(8rem / 15)",
            flexWrap: "wrap",
            minWidth: 0,
          }}
        >
          {title}
          {titleSuffix}
        </h1>
        {subtitle && (
          <Box
            component="span"
            title={typeof subtitle === "string" ? subtitle : undefined}
            sx={{
              fontSize: "calc(13rem / 15)",
              fontWeight: 500,
              color: p.text.secondary,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              // Own line on a phone; truncated beside the title elsewhere.
              flex: { xs: "1 1 100%", md: "0 1 auto" },
            }}
          >
            {subtitle}
          </Box>
        )}
      </Box>
      {actions && phone && (
        <>
          <IconButton size="lg" aria-label="Page actions" data-testid="page-actions-more" onClick={(e) => setMoreAnchor(e.currentTarget)} style={{ marginLeft: "auto" }}>
            <MoreHorizontal />
          </IconButton>
          <Popover
            open={Boolean(moreAnchor)}
            anchorEl={moreAnchor}
            onClose={() => setMoreAnchor(null)}
            anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
            transformOrigin={{ vertical: "top", horizontal: "right" }}
          >
            <div data-testid="page-actions-menu" onClick={closeOnAction} style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: "calc(8rem / 15)", padding: "calc(12rem / 15)", minWidth: "calc(200rem / 15)" }}>
              {actions}
            </div>
          </Popover>
        </>
      )}
      {actions && !phone && (
        // Wraps internally: a detail page's actions are wider than a phone
        // (regression 2026-09-19 — the primary button was clipped away).
        <div style={{ display: "flex", alignItems: "center", gap: "calc(8rem / 15)", flexWrap: "wrap", justifyContent: "flex-end", marginLeft: "auto" }}>
          {actions}
        </div>
      )}
    </Box>
  );

  const tabRow = tabs ? <div style={{ marginBottom: "calc(4rem / 15)" }}>{tabs}</div> : null;

  if (slot) {
    return (
      <>
        {createPortal(line, slot)}
        {tabRow}
      </>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "calc(6rem / 15)", paddingBottom: "calc(4rem / 15)" }}>
      {line}
      {tabRow}
    </div>
  );
}
