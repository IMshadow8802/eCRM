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
export default function HelpGuide({ guide, defaultLang = "hi" }) {
  const [anchor, setAnchor] = useState(null);
  const [lang, setLang] = useState(defaultLang);
  const theme = useTheme();
  const p = theme.tokens ?? palettes.light;
  const r = theme.radii ?? radii;

  if (!guide) return null;

  const title = lang === "hi" ? guide.titleHi : guide.titleEn;
  const steps = (guide.steps || []).map((s) => (lang === "hi" ? s.hi : s.en));

  const langBtn = (code, label) => (
    <button
      type="button"
      onClick={() => setLang(code)}
      aria-pressed={lang === code}
      data-testid={`help-lang-${code}`}
      style={{
        border: "none",
        cursor: "pointer",
        padding: "3px 10px",
        fontSize: 12,
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
              maxWidth: 400,
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
            gap: 12,
            marginBottom: 10,
          }}
        >
          <strong style={{ fontSize: 14, color: p.text.primary }}>{title}</strong>
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
        <ol
          style={{
            margin: 0,
            paddingLeft: 18,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {steps.map((s, i) => (
            <li key={i} style={{ fontSize: 13, lineHeight: 1.55, color: p.text.secondary }}>
              {s}
            </li>
          ))}
        </ol>
      </Popover>
    </>
  );
}
