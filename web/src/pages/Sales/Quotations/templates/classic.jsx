// Classic — a formal letterhead: logo left, company right, one accent rule.
// The safe choice for a customer's accounts department.
import { Document, Page, View, Text, Image } from "@react-pdf/renderer";
import { PartyBlock, Subject, LineTable, TotalsBlock, RichSection, ExtraSections, BankAndSign, PageFooter, DraftWatermark } from "../pdf/parts";
import { pageStyle, INK, MUTED } from "../pdf/tokens";

export default function Classic({ doc }) {
  return (
    <Document title={`${doc.title} ${doc.quoteNo}`} author={doc.company.name}>
      <Page size="A4" style={pageStyle}>
        <DraftWatermark doc={doc} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          {doc.logoSrc ? <Image src={doc.logoSrc} style={{ width: 64, height: 64, objectFit: "contain" }} /> : null}
          <View style={{ flex: 1, alignItems: "flex-end" }}>
            <Text style={{ fontSize: 16, fontWeight: 700, color: INK }}>{doc.company.name}</Text>
            {doc.company.addressLines.map((l) => <Text key={l} style={{ fontSize: 8.5, color: MUTED }}>{l}</Text>)}
            {doc.company.contactLine ? <Text style={{ fontSize: 8.5, color: MUTED }}>{doc.company.contactLine}</Text> : null}
            {doc.company.gstin ? <Text style={{ fontSize: 8.5, color: INK, fontWeight: 700 }}>GSTIN {doc.company.gstin}</Text> : null}
          </View>
        </View>
        <View style={{ height: 2, backgroundColor: doc.accent, marginTop: 10 }} />
        {doc.headerSrc ? <Image src={doc.headerSrc} style={{ height: 80, objectFit: "cover", marginTop: 10, borderRadius: 3 }} /> : null}
        <Text style={{ fontSize: 13, fontWeight: 700, textAlign: "center", letterSpacing: 3, color: doc.accent, marginVertical: 12 }}>QUOTATION</Text>

        <PartyBlock doc={doc} />
        <Subject doc={doc} />
        <RichSection html={doc.intro} accent={doc.accent} />
        <LineTable doc={doc} variant="ruled" />
        <TotalsBlock doc={doc} emphasis="bar" />
        <RichSection title="Notes" html={doc.notes} accent={doc.accent} />
        <ExtraSections doc={doc} />
        <RichSection title="Terms & conditions" html={doc.terms} accent={doc.accent} />
        <BankAndSign doc={doc} />
        <PageFooter doc={doc} />
      </Page>
    </Document>
  );
}
