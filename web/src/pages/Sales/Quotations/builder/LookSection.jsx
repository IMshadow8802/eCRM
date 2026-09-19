import { Box } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { TEMPLATES } from "../templates";
import { ACCENTS } from "../quoteForm";

/** Which template, and which accent colour. This is THEIR document, so it is THEIR colour — nothing to do with how our app is branded. */
export default function LookSection({ templateCode, accent, disabled = false, onTemplate, onAccent }) {
  const theme = useTheme();
  const p = theme.tokens;
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      <Box role="radiogroup" aria-label="Template" sx={{ display: "grid", gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: "repeat(3, minmax(0, 1fr))" }, gap: 1 }}>
        {TEMPLATES.map((t) => {
          const on = t.code === templateCode;
          return (
            <button key={t.code} type="button" role="radio" aria-checked={on} disabled={disabled} onClick={() => onTemplate(t.code)} data-testid={`template-${t.code}`}
              style={{ textAlign: "left", padding: 10, borderRadius: theme.radii.md, cursor: disabled ? "default" : "pointer", background: on ? p.primary.subtle : p.surface.card,
                border: `1.5px solid ${on ? p.primary.main : p.border.default}`, color: p.text.primary, fontFamily: p.fontFamilies.sans }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{t.name}</div>
              <div style={{ fontSize: 11, color: p.text.tertiary, marginTop: 2 }}>{t.blurb}</div>
            </button>
          );
        })}
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: p.text.secondary, marginRight: 4 }}>Accent</span>
        {ACCENTS.map((c) => (
          <button key={c} type="button" aria-label={`Accent ${c}`} aria-pressed={accent === c} disabled={disabled} onClick={() => onAccent(c)}
            style={{ width: 24, height: 24, borderRadius: 999, background: c, cursor: disabled ? "default" : "pointer", border: accent === c ? `2px solid ${p.text.primary}` : `1px solid ${p.border.strong}` }} />
        ))}
        {/* The platform's own picker for "any colour" — no colour-picker dependency. */}
        <input type="color" aria-label="Custom accent" value={accent} disabled={disabled} onChange={(e) => onAccent(e.target.value)}
          style={{ width: 30, height: 26, padding: 0, border: "none", background: "none" }} />
      </Box>
    </Box>
  );
}
