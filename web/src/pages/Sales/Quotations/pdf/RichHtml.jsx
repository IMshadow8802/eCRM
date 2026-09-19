// Editor HTML → PDF. The HTML is already reduced to tags the converter can draw
// (richTextHtml.toPdfHtml, called in buildQuoteDoc), so nothing is dropped here.
import HtmlPkg from "react-pdf-html";
import { INK, MUTED, RULE, SOFT } from "./tokens";

const Html = HtmlPkg.default ?? HtmlPkg.Html ?? HtmlPkg;

const sheet = (accent) => ({
  p: { margin: 0, marginBottom: 4, fontSize: 9.5, lineHeight: 1.45 },
  h1: { fontSize: 15, fontWeight: 700, margin: 0, marginTop: 6, marginBottom: 5, color: INK },
  h2: { fontSize: 12.5, fontWeight: 700, margin: 0, marginTop: 6, marginBottom: 4, color: INK },
  h3: { fontSize: 10.5, fontWeight: 700, margin: 0, marginTop: 5, marginBottom: 3, color: INK },
  // Lists keep the converter's own bullet/number layout — resetting it (tried)
  // collapses the marker onto the first letter of the text.
  ul: { marginTop: 0, marginBottom: 4 },
  ol: { marginTop: 0, marginBottom: 4 },
  a: { color: accent },
  hr: { marginVertical: 6, borderBottom: `1px solid ${RULE}` },
  blockquote: { margin: 0, marginVertical: 4, paddingLeft: 8, borderLeft: `2px solid ${RULE}`, color: MUTED },
  table: { marginVertical: 5 },
  th: { padding: 4, backgroundColor: SOFT, fontWeight: 700, borderBottom: `1px solid ${RULE}` },
  td: { padding: 4, borderBottom: `1px solid ${RULE}` },
});

export default function RichHtml({ html, accent }) {
  if (!html) return null;
  return <Html stylesheet={sheet(accent)} style={{ fontSize: 9.5, color: INK }}>{html}</Html>;
}
