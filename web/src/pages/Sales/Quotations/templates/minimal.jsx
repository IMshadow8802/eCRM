// Minimal — no fills, hairlines and air. The accent appears exactly twice: the
// word "Quotation" and the grand total.
import { Document, Page, View, Text, Image } from "@react-pdf/renderer";
import { PartyBlock, Subject, LineTable, TotalsBlock, RichSection, ExtraSections, BankAndSign, PageFooter, DraftWatermark } from "../pdf/parts";
import { pageStyle, INK, MUTED, RULE } from "../pdf/tokens";

export default function Minimal({ doc }) {
  return (
    <Document title={`${doc.title} ${doc.quoteNo}`} author={doc.company.name}>
      <Page size="A4" style={[pageStyle, { paddingTop: 44, paddingHorizontal: 44 }]}>
        <DraftWatermark doc={doc} />
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
          <View>
            <Text style={{ fontSize: 26, fontWeight: 700, color: doc.accent, letterSpacing: -0.5 }}>Quotation</Text>
            <Text style={{ fontSize: 9, color: MUTED, marginTop: 2 }}>{doc.quoteNo}{doc.quoteDate ? `  ·  ${doc.quoteDate}` : ""}</Text>
          </View>
          <View style={{ alignItems: "flex-end", maxWidth: 260 }}>
            {doc.logoSrc ? <Image src={doc.logoSrc} style={{ width: 44, height: 44, objectFit: "contain", marginBottom: 5 }} /> : null}
            <Text style={{ fontSize: 11, fontWeight: 700, color: INK }}>{doc.company.name}</Text>
            {doc.company.addressLines.map((l) => <Text key={l} style={{ fontSize: 8, color: MUTED, textAlign: "right" }}>{l}</Text>)}
            {doc.company.contactLine ? <Text style={{ fontSize: 8, color: MUTED }}>{doc.company.contactLine}</Text> : null}
            {doc.company.gstin ? <Text style={{ fontSize: 8, color: MUTED }}>GSTIN {doc.company.gstin}</Text> : null}
          </View>
        </View>
        {doc.headerSrc ? <Image src={doc.headerSrc} style={{ height: 70, objectFit: "cover", marginTop: 14 }} /> : null}
        <View style={{ height: 1, backgroundColor: RULE, marginVertical: 16 }} />

        <PartyBlock doc={doc} />
        <Subject doc={doc} />
        <RichSection html={doc.intro} accent={INK} />
        <LineTable doc={doc} variant="bare" />
        <TotalsBlock doc={doc} emphasis="rule" />
        <RichSection title="Notes" html={doc.notes} accent={INK} />
        <ExtraSections doc={doc} />
        <RichSection title="Terms & conditions" html={doc.terms} accent={INK} />
        <BankAndSign doc={doc} />
        <PageFooter doc={doc} inset={44} />
      </Page>
    </Document>
  );
}
