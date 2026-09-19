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
        <iframe title="Quotation preview" src={`${instance.url}#toolbar=0&navpanes=0`} style={{ width: "100%", height: "100%", border: "none" }} />
      ) : (
        <div style={{ padding: 16, fontSize: 13, color: p.text.tertiary }}>Drawing the preview…</div>
      )}
    </div>
  );
}
