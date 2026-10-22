// src/pages/Sales/VisitingCards/CardDetailModal.jsx
import { useState } from "react";
import { Box } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { ImageOff, X } from "lucide-react";

import Modal from "../../../components/ui/Modal";
import { Skeleton } from "../../../components/ui";
import { formatDateTime } from "../../../utils/format";
import { cardName, cardPerson, faceIndex } from "./cardColor";
import useCardPhoto from "./useCardPhoto";

// One photo: loading → image | placeholder. Owns and revokes its URL. The
// placeholder keeps the card's shape and tint so a missing photo still looks
// like a card, not a hole.
function CardPhoto({ path, label, cardId, onOpen }) {
  const state = useCardPhoto(path);
  const { ink, inkDim, tints } = useTheme().tokens.cardFace;
  const tint = tints[faceIndex(cardId)];

  if (!state.url) {
    return (
      <Box sx={{ aspectRatio: "1.6", borderRadius: 1, backgroundColor: tint, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 1, color: inkDim }}>
        {state.failed ? (
          <>
            <ImageOff size={28} color={ink} aria-hidden="true" />
            <Box sx={{ fontSize: "0.8rem", fontWeight: 600 }}>Photo unavailable</Box>
          </>
        ) : (
          <Skeleton rounded={0} style={{ width: "100%", height: "100%", backgroundColor: tint }} aria-label="Loading photo" />
        )}
      </Box>
    );
  }
  return (
    <Box
      component="img" src={state.url} alt={label} onClick={() => onOpen(state.url, label)}
      sx={{ width: "100%", borderRadius: 1, cursor: "zoom-in", display: "block" }}
    />
  );
}

const Field = ({ label, children }) => (
  <Box sx={{ mb: 1.5 }}>
    <Box sx={{ fontSize: "0.75rem", color: "text.secondary" }}>{label}</Box>
    <Box sx={{ fontSize: "0.9rem" }}>{children}</Box>
  </Box>
);

const Links = ({ items, scheme }) =>
  items.map((v, i) => <Box key={`${i}-${v}`}><a href={`${scheme}:${v}`}>{v}</a></Box>);

// The header wears the card's own pastel (same face as its tile), ink in both modes.
function Band({ card, onClose }) {
  const theme = useTheme();
  const { ink, inkDim, faces } = theme.tokens.cardFace;
  const face = faces[faceIndex(card.id)];
  const person = cardPerson(card);
  return (
    <Box data-testid="card-band" data-face={face}
      sx={{ display: "flex", alignItems: "flex-start", gap: "calc(12rem / 15)", flexShrink: 0,
        backgroundColor: face, color: ink, p: "calc(20rem / 15) calc(20rem / 15) calc(18rem / 15) calc(24rem / 15)" }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ fontSize: "calc(22rem / 15)", fontWeight: 700, lineHeight: 1.25, letterSpacing: "-0.01em", wordBreak: "break-word" }}>
          {cardName(card) || "Visiting card"}
        </Box>
        {person && <Box sx={{ mt: "calc(4rem / 15)", fontSize: "calc(14rem / 15)", fontWeight: 500, color: inkDim }}>{person}</Box>}
      </Box>
      <Box component="button" type="button" aria-label="Close modal" onClick={onClose}
        sx={{ display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          width: "calc(32rem / 15)", height: "calc(32rem / 15)", border: 0, borderRadius: "calc(8rem / 15)",
          background: face, color: ink, cursor: "pointer", "&:hover": { backgroundColor: theme.tokens.cardFace.tints[faceIndex(card.id)] } }}>
        <X size={16} />
      </Box>
    </Box>
  );
}

export default function CardDetailModal({ open, card, onClose }) {
  const [big, setBig] = useState(null);
  if (!card) return null;
  const lists = [["Mobile", card.mobiles, "tel"], ["Landline", card.landlines, "tel"], ["Email", card.emails, "mailto"]];
  const texts = [
    ["Designation", card.designation], ["Website", card.website], ["GSTIN", card.gstin],
    ["Description", card.description], ["Other", card.other], ["Notes", card.notes],
  ];
  return (
    <>
      <Modal open={open} onClose={onClose} size="xl" aria-label="Visiting card">
        <Band card={card} onClose={onClose} />
        <Modal.Body>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 3 }}>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <CardPhoto path={card.frontImage} label="Front of card" cardId={card.id} onOpen={(url, label) => setBig({ url, label })} />
              {card.backImage && <CardPhoto path={card.backImage} label="Back of card" cardId={card.id} onOpen={(url, label) => setBig({ url, label })} />}
            </Box>
            <Box>
              <Field label="Contact person">{card.contactPerson || "—"}</Field>
              {texts.slice(0, 1).map(([l, v]) => v && <Field key={l} label={l}>{v}</Field>)}
              {lists.map(([l, v, s]) => v?.length > 0 && <Field key={l} label={l}><Links items={v} scheme={s} /></Field>)}
              {card.addresses?.length > 0 && <Field label="Address">{card.addresses.map((a) => <Box key={a}>{a}</Box>)}</Field>}
              {texts.slice(1).map(([l, v]) => v && <Field key={l} label={l}>{v}</Field>)}
              <Field label="Scanned by">{card.ownerName || "—"}</Field>
              <Field label="Received">{formatDateTime(card.receivedAt, { empty: "—" })}</Field>
            </Box>
          </Box>
        </Modal.Body>
      </Modal>
      <Modal open={Boolean(big)} onClose={() => setBig(null)} size="xl" aria-label="Full size photo">
        {big && (
          <>
            <Modal.Header title={big.label} onClose={() => setBig(null)} />
            <Modal.Body><img data-testid="card-photo-full" src={big.url} alt={big.label} style={{ width: "100%" }} /></Modal.Body>
          </>
        )}
      </Modal>
    </>
  );
}
