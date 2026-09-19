import { useTheme } from "@mui/material/styles";
import { usePdfPreview } from "../usePdfPreview";

/**
 * The right half of the builder: the real PDF, in an <iframe>. A component of
 * its own because usePdfPreview is a hook — the page can only call it once the
 * document exists, and a hook cannot be called conditionally.
 * `onReady(blob)` hands the current file up so Download saves exactly what is
 * on screen.
 */
export default function PdfPreview({ Component, doc, onReady }) {
  const theme = useTheme();
  const p = theme.tokens;
  const instance = usePdfPreview(Component, doc);
  if (instance.blob) onReady?.(instance.blob);

  return (
    <div data-testid="pdf-preview" style={{ position: "relative", height: "100%", borderRadius: theme.radii.md, overflow: "hidden", border: `1px solid ${p.border.default}`, background: p.surface.subtle }}>
      {instance.error ? (
        <div role="alert" style={{ padding: 16, fontSize: 13, color: p.error.main }}>The preview could not be drawn. Your changes are safe — try again in a moment.</div>
      ) : instance.url ? (
        <>
          <iframe title="Quotation preview" src={`${instance.url}#toolbar=0&navpanes=0`} style={{ width: "100%", height: "100%", border: "none" }} />
          {/* An A4 page in a 336px frame puts 9pt body text at about 6.7 CSS
              pixels, and `toolbar=0` removes the viewer's own zoom. Worse, a
              phone may not render a PDF in an iframe at all — Chrome on
              Android shows an empty box. This opens the same blob in the
              browser's real viewer, which can zoom and scroll. */}
          <a href={instance.url} target="_blank" rel="noreferrer" data-testid="pdf-preview-open"
            style={{ position: "absolute", right: 8, bottom: 8, padding: "6px 10px", borderRadius: theme.radii.sm,
              background: p.surface.card, border: `1px solid ${p.border.default}`, color: p.text.primary,
              fontSize: 12, fontWeight: 600, textDecoration: "none", boxShadow: p.shadow.sm }}>
            Open full size
          </a>
        </>
      ) : (
        <div style={{ padding: 16, fontSize: 13, color: p.text.tertiary }}>Drawing the preview…</div>
      )}
    </div>
  );
}
