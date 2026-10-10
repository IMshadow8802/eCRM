import { useState } from "react";
import IconButton from "@mui/material/IconButton";
import Popover from "@mui/material/Popover";
import { useTheme } from "@mui/material/styles";
import { HelpCircle } from "lucide-react";

import { palettes, radii } from "../styles/tokens";

/**
 * A "?" help button that opens step-by-step instructions for a screen.
 * Shows Hindi by default with a one-click toggle to English, so anyone can
 * learn how to use the screen. `guide` = { titleHi, titleEn, steps:[{hi,en}] }.
 */
export default function HelpGuide({ guide, defaultLang = "en", isAdmin = false }) {
  const [anchor, setAnchor] = useState(null);
  const [lang, setLang] = useState(defaultLang);
  const theme = useTheme();
  const p = theme.tokens ?? palettes.light;
  const r = theme.radii ?? radii;

  if (!guide) return null;

  const t = (o) => (lang === "hi" ? o?.hi : o?.en);
  const title = lang === "hi" ? guide.titleHi : guide.titleEn;
  // A guide is either flat `steps` or grouped `sections` (each with an
  // optional heading and an `adminOnly` flag). Normalize to sections and drop
  // admin-only sections for non-admins.
  const sections = (guide.sections ?? [{ steps: guide.steps || [] }]).filter(
    (s) => !s.adminOnly || isAdmin,
  );

  const langBtn = (code, label) => (
    <button
      type="button"
      onClick={() => setLang(code)}
      aria-pressed={lang === code}
      data-testid={`help-lang-${code}`}
      style={{
        border: "none",
        cursor: "pointer",
        padding: "calc(3rem / 15) calc(10rem / 15)",
        fontSize: "calc(12rem / 15)",
        fontWeight: 600,
        borderRadius: r.full,
        color: lang === code ? "#fff" : p.text.secondary,
        backgroundColor: lang === code ? p.primary.main : "transparent",
      }}
    >
      {label}
    </button>
  );

  return (
    <>
      <IconButton
        size="small"
        onClick={(e) => setAnchor(e.currentTarget)}
        aria-label="How to use this screen"
        data-testid="help-guide-button"
        sx={{ color: p.text.secondary, "&:hover": { color: p.primary.main } }}
      >
        <HelpCircle size={18} />
      </IconButton>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{
          paper: {
            "data-testid": "help-guide-popover",
            sx: {
              p: 2,
              mt: 1,
              maxWidth: "calc(400rem / 15)",
              borderRadius: `${r.lg}px`,
              border: `1px solid ${p.border.default}`,
              backgroundColor: p.surface.card,
              color: p.text.primary,
            },
          },
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "calc(12rem / 15)",
            marginBottom: "calc(10rem / 15)",
          }}
        >
          <strong style={{ fontSize: "calc(14rem / 15)", color: p.text.primary }}>{title}</strong>
          <div
            data-testid="help-lang-toggle"
            style={{
              display: "inline-flex",
              gap: 2,
              padding: 2,
              borderRadius: r.full,
              backgroundColor: p.surface.subtle,
              flexShrink: 0,
            }}
          >
            {langBtn("hi", "हिंदी")}
            {langBtn("en", "English")}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "calc(14rem / 15)", maxHeight: "calc(440rem / 15)", overflowY: "auto" }}>
          {sections.map((section, si) => (
            <div key={si}>
              {(section.headingHi || section.headingEn) && (
                <div
                  style={{
                    fontSize: "calc(12rem / 15)",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    color: section.adminOnly ? p.primary.main : p.text.tertiary,
                    marginBottom: "calc(6rem / 15)",
                  }}
                >
                  {lang === "hi" ? section.headingHi : section.headingEn}
                </div>
              )}
              <ol
                style={{
                  margin: 0,
                  paddingLeft: "calc(18rem / 15)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "calc(6rem / 15)",
                }}
              >
                {(section.steps || []).map((step, i) => (
                  <li key={i} style={{ fontSize: "calc(13rem / 15)", lineHeight: 1.55, color: p.text.secondary }}>
                    {t(step)}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </Popover>
    </>
  );
}
