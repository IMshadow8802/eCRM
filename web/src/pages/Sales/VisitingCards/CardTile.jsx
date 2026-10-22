// src/pages/Sales/VisitingCards/CardTile.jsx — one scanned card in the grid.
import { Box } from "@mui/material";
import { useTheme } from "@mui/material/styles";

import { Skeleton } from "../../../components/ui";
import { formatDate } from "../../../utils/format";
import { rem } from "../../../utils/rem";
import { motion } from "../../../styles/tokens";
import { cardName, cardPerson, faceIndex, mainContact } from "./cardColor";
import useCardPhoto from "./useCardPhoto";

const line = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };


/**
 * Front photo on top (card-shaped, 1.6), a solid pastel panel below in the
 * card's own colour. The tile is its own surface: ink on pastel in both modes.
 */
export default function CardTile({ card, onOpen }) {
  const theme = useTheme();
  const { ink, inkDim, faces, tints } = theme.tokens.cardFace;
  const i = faceIndex(card.id);
  const photo = useCardPhoto(card.frontImage);
  const name = cardName(card);
  const person = cardPerson(card);
  const { main, more } = mainContact(card);
  const footer = [card.ownerName, formatDate(card.receivedAt)].filter(Boolean);

  return (
    <Box
      role="button"
      tabIndex={0}
      aria-label={`Open ${name || "untitled card"}`}
      data-testid={`card-tile-${card.id}`}
      data-face={faces[i]}
      onClick={() => onOpen(card)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(card); }
      }}
      sx={{
        display: "flex", flexDirection: "column", minWidth: 0, cursor: "pointer",
        borderRadius: rem(theme.radii.lg), overflow: "hidden",
        backgroundColor: faces[i], color: ink,
        boxShadow: theme.tokens.elevation[1],
        transition: `transform ${motion.duration.base}ms ${motion.easing.standard}, box-shadow ${motion.duration.base}ms ${motion.easing.standard}`,
        "&:hover, &:focus-visible": { transform: "translateY(calc(-4rem / 15))", boxShadow: theme.tokens.elevation[3] },
        "@media (prefers-reduced-motion: reduce)": { transition: "none", "&:hover, &:focus-visible": { transform: "none" } },
      }}
    >
      <Box sx={{ aspectRatio: "1.6", backgroundColor: tints[i], position: "relative" }}>
        {photo.url && (
          <Box component="img" src={photo.url} alt={`Front of ${name || "card"}`}
            sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        )}
        {!photo.url && !photo.failed && (
          <Skeleton data-testid={`card-skeleton-${card.id}`} rounded={0} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", backgroundColor: tints[i] }} />
        )}
        {photo.failed && (
          <Box data-testid={`card-fallback-${card.id}`} aria-hidden="true"
            sx={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "calc(56rem / 15)", fontWeight: 700, letterSpacing: "-0.02em", color: ink }}>
            {(name.trim()[0] || "?").toUpperCase()}
          </Box>
        )}
      </Box>

      <Box sx={{ p: "calc(14rem / 15) calc(16rem / 15) calc(12rem / 15)", display: "flex", flexDirection: "column", gap: "calc(4rem / 15)", minWidth: 0 }}>
        {card.description && (
          <Box sx={{ ...line, fontSize: "calc(11rem / 15)", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: inkDim }}>
            {card.description}
          </Box>
        )}
        <Box sx={{ fontSize: "calc(17rem / 15)", fontWeight: 700, lineHeight: 1.25, letterSpacing: "-0.01em",
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", wordBreak: "break-word" }}>
          {name || "Untitled card"}
        </Box>
        {person && <Box sx={{ ...line, fontSize: "calc(13rem / 15)", fontWeight: 500, color: inkDim }}>{person}</Box>}
        {main && (
          <Box sx={{ display: "flex", alignItems: "baseline", gap: "calc(6rem / 15)", minWidth: 0, fontSize: "calc(13rem / 15)", fontWeight: 600 }}>
            <Box component="span" sx={{ ...line, fontVariantNumeric: "tabular-nums" }}>{main}</Box>
            {more > 0 && <Box component="span" sx={{ color: inkDim, fontWeight: 600, flexShrink: 0 }}>{`+${more}`}</Box>}
          </Box>
        )}
        {footer.length > 0 && (
          <Box sx={{ display: "flex", gap: "calc(6rem / 15)", mt: "calc(6rem / 15)", fontSize: "calc(12rem / 15)", fontWeight: 500, color: inkDim, minWidth: 0 }}>
            {footer.map((t, k) => [
              k > 0 && <span key={`dot${k}`} aria-hidden="true">·</span>,
              <Box component="span" key={k} sx={k === 0 ? { ...line, minWidth: 0 } : { flexShrink: 0 }}>{t}</Box>,
            ])}
          </Box>
        )}
      </Box>
    </Box>
  );
}
