// The pieces every template shares. A template decides the header and the mood;
// what a line table, a totals block or a terms section IS does not change
// between them — and a fix to page-breaking must not need making three times.
import { View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import RichHtml from "./RichHtml";
import { INK, MUTED, RULE, SOFT } from "./tokens";

const s = StyleSheet.create({
  label: { fontSize: 7.5, color: MUTED, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 3 },
  strong: { fontSize: 10.5, fontWeight: 700, color: INK },
  small: { fontSize: 8.5, color: MUTED, lineHeight: 1.4 },
  row: { flexDirection: "row" },
  cell: { fontSize: 9, paddingVertical: 5, paddingHorizontal: 4, color: INK },
  num: { textAlign: "right" },
  sectionTitle: { fontSize: 10, fontWeight: 700, marginBottom: 4 },
});

/** "To" on the left, the quotation's own facts on the right. */
export function PartyBlock({ doc, boxed = false }) {
  const box = boxed ? { backgroundColor: SOFT, borderRadius: 4, padding: 10 } : {};
  const facts = [
    ["Quotation no.", doc.quoteNo], ["Date", doc.quoteDate],
    ...(doc.validTill ? [["Valid till", doc.validTill]] : []),
    ...(doc.to.placeOfSupply ? [["Place of supply", doc.to.placeOfSupply]] : []),
  ];
  return (
    <View style={[s.row, { gap: 14, marginBottom: 14 }]}>
      <View style={[{ flex: 1.25 }, box]}>
        <Text style={s.label}>Quotation for</Text>
        <Text style={s.strong}>{doc.to.company || doc.to.name}</Text>
        {doc.to.company ? <Text style={[s.small, { color: INK }]}>{doc.to.name}</Text> : null}
        {doc.to.addressLines.map((l) => <Text key={l} style={s.small}>{l}</Text>)}
        {doc.to.contactLine ? <Text style={s.small}>{doc.to.contactLine}</Text> : null}
        {doc.to.gstin ? <Text style={s.small}>GSTIN {doc.to.gstin}</Text> : null}
      </View>
      <View style={[{ flex: 1 }, box]}>
        {facts.map(([k, v]) => (
          <View key={k} style={[s.row, { justifyContent: "space-between", marginBottom: 3 }]}>
            <Text style={s.small}>{k}</Text>
            <Text style={{ fontSize: 9, fontWeight: 700, color: INK }}>{v}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function Subject({ doc }) {
  if (!doc.subject) return null;
  return <Text style={{ fontSize: 10, fontWeight: 700, marginBottom: 8 }}>Subject: {doc.subject}</Text>;
}

/**
 * variant: "filled" (accent header, zebra rows) | "ruled" (grey header, row rules) | "bare" (hairlines only)
 * Each row is wrap={false}: a line item is never sliced across two pages.
 */
export function LineTable({ doc, variant = "ruled" }) {
  const cols = [
    { key: "sr", head: "#", w: 20 },
    { key: "description", head: "Description", flex: 1 },
    ...(doc.showHsn ? [{ key: "hsn", head: "HSN/SAC", w: 46 }] : []),
    { key: "qtyText", head: "Qty", w: 52, num: true },
    { key: "rateText", head: "Rate", w: 68, num: true },
    ...(doc.showDiscount ? [{ key: "discountText", head: "Disc.", w: 54, num: true }] : []),
    ...(doc.taxed ? [{ key: "taxPctText", head: "GST", w: 34, num: true }] : []),
    { key: "amountText", head: "Amount", w: 78, num: true },
  ];
  const size = (c) => (c.flex ? { flex: c.flex } : { width: c.w });
  const headStyle = variant === "filled"
    ? { backgroundColor: doc.accent, borderRadius: 3 }
    : variant === "ruled" ? { backgroundColor: SOFT, borderTop: `1px solid ${RULE}`, borderBottom: `1px solid ${RULE}` }
      : { borderBottom: `1px solid ${INK}` };
  const headText = { fontSize: 8, fontWeight: 700, color: variant === "filled" ? "#ffffff" : variant === "bare" ? INK : MUTED };

  return (
    <View style={{ marginBottom: 10 }}>
      {/* `fixed` repeats the header on every page the table spans. Without it a
          customer reading page 2 of a long list sees Rate, Disc. and Amount as
          three unlabelled currency columns. */}
      <View style={[s.row, headStyle]} wrap={false} fixed>
        {cols.map((c) => <Text key={c.key} style={[s.cell, headText, size(c), c.num && s.num]}>{c.head}</Text>)}
      </View>
      {doc.rows.map((r, i) => (
        <View key={r.sr} wrap={false}
          style={[s.row, variant === "filled" ? { backgroundColor: i % 2 ? SOFT : "#ffffff" } : { borderBottom: `1px solid ${RULE}` }]}>
          {cols.map((c) => <Text key={c.key} style={[s.cell, size(c), c.num && s.num]}>{r[c.key]}</Text>)}
        </View>
      ))}
    </View>
  );
}

/** Tax by rate on the left (only when there is tax to break down), the totals on the right. */
export function TotalsBlock({ doc, emphasis = "bar" }) {
  const grand = emphasis === "bar"
    ? { box: { backgroundColor: doc.accent, borderRadius: 3, paddingVertical: 6, paddingHorizontal: 8, marginTop: 4 }, text: "#ffffff" }
    : { box: { borderTop: `1px solid ${INK}`, paddingTop: 6, marginTop: 4 }, text: INK };
  return (
    <View wrap={false} style={{ marginBottom: 12 }}>
      <View style={[s.row, { gap: 16 }]}>
        <View style={{ flex: 1 }}>
          {doc.gstSummary.length > 0 && (
            <View>
              <Text style={s.label}>Tax summary</Text>
              <View style={[s.row, { borderBottom: `1px solid ${RULE}` }]}>
                {["GST", "Taxable", ...(doc.inter ? ["IGST"] : ["CGST", "SGST"])].map((h, i) => (
                  <Text key={h} style={[{ fontSize: 7.5, color: MUTED, paddingVertical: 3, flex: 1 }, i > 0 && s.num]}>{h}</Text>
                ))}
              </View>
              {doc.gstSummary.map((g) => (
                <View key={g.rateText} style={s.row}>
                  {[g.rateText, g.taxableText, ...(doc.inter ? [g.igstText] : [g.cgstText, g.sgstText])].map((v, i) => (
                    <Text key={i} style={[{ fontSize: 8, paddingVertical: 3, flex: 1, color: INK }, i > 0 && s.num]}>{v}</Text>
                  ))}
                </View>
              ))}
            </View>
          )}
        </View>
        <View style={{ width: 210 }}>
          {doc.totals.map((t) => (
            <View key={t.label} style={[s.row, { justifyContent: "space-between", paddingVertical: 2.5 }]}>
              <Text style={{ fontSize: 9, color: MUTED }}>{t.label}</Text>
              <Text style={{ fontSize: 9, color: INK }}>{t.value}</Text>
            </View>
          ))}
          <View style={[s.row, { justifyContent: "space-between", alignItems: "center" }, grand.box]}>
            <Text style={{ fontSize: 10, fontWeight: 700, color: grand.text }}>Grand total</Text>
            <Text style={{ fontSize: 12, fontWeight: 700, color: grand.text }}>{doc.grandTotalText}</Text>
          </View>
        </View>
      </View>
      <Text style={{ fontSize: 8.5, color: MUTED, marginTop: 6 }}>
        Amount in words: <Text style={{ color: INK, fontWeight: 700 }}>{doc.amountInWords}</Text>
      </Text>
    </View>
  );
}

// ponytail: a short section moves to the next page whole rather than leaving a
// table's header row stranded at the foot of one page and its body on the next.
// Length of the HTML is a crude proxy for height; a long section must be
// allowed to break or it would never fit any page.
const KEEP_TOGETHER_BELOW = 1200;

export function RichSection({ title, html, accent }) {
  if (!html) return null;
  return (
    <View wrap={html.length > KEEP_TOGETHER_BELOW} style={{ marginBottom: 10 }}>
      {title ? <Text style={[s.sectionTitle, { color: accent }]}>{title}</Text> : null}
      <RichHtml html={html} accent={accent} />
    </View>
  );
}

/** The user's own appended sections: formatted text, or a grid of captioned pictures. */
export function ExtraSections({ doc }) {
  return doc.sections.map((sec, i) =>
    sec.type === "images" ? (
      <View key={i} style={{ marginBottom: 10 }}>
        {sec.title ? <Text style={[s.sectionTitle, { color: doc.accent }]}>{sec.title}</Text> : null}
        <View style={[s.row, { flexWrap: "wrap", gap: 8 }]}>
          {sec.items.map((im, j) => (
            <View key={j} wrap={false} style={{ width: 166 }}>
              <Image src={im.src} style={{ width: 166, height: 112, objectFit: "cover", borderRadius: 3 }} />
              {im.caption ? <Text style={[s.small, { marginTop: 3 }]}>{im.caption}</Text> : null}
            </View>
          ))}
        </View>
      </View>
    ) : <RichSection key={i} title={sec.title} html={sec.html} accent={doc.accent} />,
  );
}

export function BankAndSign({ doc }) {
  if (!doc.company.bank && !doc.company.signatory) return null;
  return (
    <View wrap={false} style={[s.row, { justifyContent: "space-between", marginTop: 8, gap: 20 }]}>
      <View style={{ flex: 1 }}>
        {doc.company.bank ? (<><Text style={s.label}>Bank details</Text><Text style={s.small}>{doc.company.bank}</Text></>) : null}
      </View>
      <View style={{ width: 190, alignItems: "flex-end" }}>
        <Text style={s.small}>For {doc.company.name}</Text>
        <View style={{ height: 34 }} />
        <Text style={{ fontSize: 9, fontWeight: 700, borderTop: `1px solid ${RULE}`, paddingTop: 3, width: 150, textAlign: "right" }}>
          {doc.company.signatory || "Authorised signatory"}
        </Text>
      </View>
    </View>
  );
}

/** Fixed on every page: the quote number, and page x of y. */
export function PageFooter({ doc, inset = 36 }) {
  return (
    <View fixed style={[s.row, { position: "absolute", bottom: 18, left: inset, right: inset, justifyContent: "space-between", borderTop: `1px solid ${RULE}`, paddingTop: 5 }]}>
      <Text style={{ fontSize: 7.5, color: MUTED }}>{doc.company.name}{doc.quoteNo ? `  ·  ${doc.quoteNo}` : ""}</Text>
      <Text style={{ fontSize: 7.5, color: MUTED }} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  );
}

/** A draft must never be mistaken for an offer. */
export function DraftWatermark({ doc }) {
  if (!doc.isDraft) return null;
  return (
    <View fixed style={{ position: "absolute", top: 330, left: 0, right: 0, alignItems: "center" }}>
      <Text style={{ fontSize: 110, fontWeight: 700, color: "#f1f5f9", transform: "rotate(-28deg)", letterSpacing: 8 }}>DRAFT</Text>
    </View>
  );
}

