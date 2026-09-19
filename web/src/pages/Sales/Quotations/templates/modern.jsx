// Modern — a full-bleed accent band carries the name; the logo sits on a white
// chip so ANY logo (dark, light, transparent) stays legible on ANY accent.
import { Document, Page, View, Text, Image } from "@react-pdf/renderer";
import { PartyBlock, Subject, LineTable, TotalsBlock, RichSection, ExtraSections, BankAndSign, PageFooter, DraftWatermark } from "../pdf/parts";
import { pageStyle } from "../pdf/tokens";

export default function Modern({ doc }) {
  return (
    <Document title={`${doc.title} ${doc.quoteNo}`} author={doc.company.name}>
      <Page size="A4" style={pageStyle}>
        <DraftWatermark doc={doc} />
        {/* Negative margins, not a zero page padding: the band bleeds to the edge on
            page 1 while pages 2+ keep their top margin. */}
        <View style={{ backgroundColor: doc.accent, marginTop: -36, marginHorizontal: -36, paddingHorizontal: 36, paddingVertical: 20, flexDirection: "row", alignItems: "center", gap: 14 }}>
          {doc.logoSrc ? (
            <View style={{ backgroundColor: "#ffffff", borderRadius: 6, padding: 6 }}>
              <Image src={doc.logoSrc} style={{ width: 54, height: 54, objectFit: "contain" }} />
            </View>
          ) : null}
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 17, fontWeight: 700, color: "#ffffff" }}>{doc.company.name}</Text>
            {doc.company.addressLines.map((l) => <Text key={l} style={{ fontSize: 8.5, color: "#ffffff", opacity: 0.9 }}>{l}</Text>)}
            {doc.company.contactLine ? <Text style={{ fontSize: 8.5, color: "#ffffff", opacity: 0.9 }}>{doc.company.contactLine}</Text> : null}
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={{ fontSize: 20, fontWeight: 700, color: "#ffffff", letterSpacing: 1 }}>QUOTATION</Text>
            {doc.company.gstin ? <Text style={{ fontSize: 8.5, color: "#ffffff", opacity: 0.9 }}>GSTIN {doc.company.gstin}</Text> : null}
          </View>
        </View>
        {doc.headerSrc ? <Image src={doc.headerSrc} style={{ marginHorizontal: -36, height: 92, objectFit: "cover" }} /> : null}
        <View style={{ height: 16 }} />

        <PartyBlock doc={doc} boxed />
        <Subject doc={doc} />
        <RichSection html={doc.intro} accent={doc.accent} />
        <LineTable doc={doc} variant="filled" />
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
