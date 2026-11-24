// src/components/PhoneMarkBanner.jsx — the do-not-call / caution warning on a number (149, spec 11).
// One mark per number: the server sends PhoneMark for either of a record's numbers,
// so a mark on the alternate number shows here too. Solid surfaces only.
import { useTheme } from "@mui/material/styles";
import { Ban, TriangleAlert } from "lucide-react";

import Tooltip from "./ui/Tooltip";
import { formatDate } from "../utils/format";

const WORDS = { dnc: "Do not call", caution: "Call with caution" };

export default function PhoneMarkBanner({ mark, note, by, at }) {
  const p = useTheme().tokens;
  if (!WORDS[mark]) return null;
  const dnc = mark === "dnc";
  const who = [by && `marked by ${by}`, at && formatDate(at)].filter(Boolean).join(", ");
  const text = [note, who].filter(Boolean).join(" · ");
  const Icon = dnc ? Ban : TriangleAlert;
  return (
    <div role={dnc ? "alert" : "status"} data-testid="phone-mark-banner"
      style={{
        display: "flex", alignItems: "center", gap: "calc(12rem / 15)", padding: "calc(12rem / 15) calc(16rem / 15)", borderRadius: "calc(12rem / 15)",
        background: dnc ? p.error.main : p.warning.subtle, color: dnc ? p.error.contrastText : p.text.primary,
        border: `1px solid ${dnc ? p.error.main : p.warning.border}`, fontSize: "calc(14rem / 15)",
      }}>
      <Icon size={20} color={dnc ? p.error.contrastText : p.warning.text} aria-hidden />
      <span><b>{WORDS[mark]}</b>{text ? ` — ${text}` : ""}</span>
    </div>
  );
}

/** An 8px solid dot for a list row's number. */
export function PhoneMarkDot({ mark }) {
  const p = useTheme().tokens;
  if (!WORDS[mark]) return null;
  return (
    <Tooltip title={WORDS[mark]}>
      <span role="img" aria-label={WORDS[mark]} data-testid="phone-mark-dot"
        style={{ display: "inline-block", width: "calc(8rem / 15)", height: "calc(8rem / 15)", borderRadius: "50%", marginLeft: "calc(6rem / 15)", verticalAlign: "middle", background: mark === "dnc" ? p.error.main : p.warning.main }} />
    </Tooltip>
  );
}
