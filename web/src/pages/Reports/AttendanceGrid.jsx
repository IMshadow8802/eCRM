// src/pages/Reports/AttendanceGrid.jsx
//
// The attendance month grid (spec 2026-10-10 §2.4): person × day, one fixed word
// per cell, totals per person. Scrolls sideways inside its own box; the name
// column stays put.
import { Box } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import dayjs from "dayjs";

import { formatValue } from "./reportUtils";

/** 6.5 → "6½", 0.5 → "½". Present and working days count a half-day leave as half. */
// eslint-disable-next-line react-refresh/only-export-components -- tiny formatter, shared with the page
export const halves = (v) => {
  const whole = Math.floor(v);
  return v % 1 ? `${whole || ""}½` : String(whole);
};

const mins = (v) => (v == null ? "—" : formatValue("minutes", v));

// code → { text, label, tone }. Late shows its minutes.
const CELL = {
  on_time: { text: "✓", label: "On time", tone: "success" },
  late: { text: (c) => String(c.lateMin), label: (c) => `Late ${c.lateMin} minutes`, tone: "warning" },
  absent: { text: "A", label: "Absent", tone: "error" },
  leave: { text: "LV", label: "On leave", tone: "primary" },
  half: { text: "½", label: (c) => (c.lateMin ? `Half-day leave, late ${c.lateMin} minutes` : "Half-day leave"), tone: "primary" },
  on_duty: { text: "OD", label: "On duty", tone: "info" },
  holiday: { text: "HO", label: "Holiday", tone: "muted" },
  off: { text: "–", label: "Weekly off", tone: "muted" },
  future: { text: "", label: "Not yet", tone: "blank" },
  before_start: { text: "", label: "Before tracking started", tone: "blank" },
};
const NOT_A_DAY = new Set(["future", "before_start"]);
const pick = (v, c) => (typeof v === "function" ? v(c) : v);

/** The word a cell stands for, for screen readers and the CSV. */
// eslint-disable-next-line react-refresh/only-export-components -- one table of words, two readers
export const cellLabel = (c) => pick(CELL[c.code]?.label ?? c.code, c);

// The legend, in the order a manager reads it.
// eslint-disable-next-line react-refresh/only-export-components
export const LEGEND = ["on_time", "late", "absent", "leave", "half", "on_duty", "holiday", "off"];

function useTones() {
  const p = useTheme().tokens;
  return {
    success: { color: p.success.hover, background: p.success.subtle },
    warning: { color: p.warning.text, background: p.warning.subtle },
    error: { color: p.error.hover, background: p.error.subtle },
    primary: { color: p.primary.hover, background: p.primary.subtle },
    info: { color: p.info.hover, background: p.info.subtle },
    muted: { color: p.text.secondary, background: p.surface.subtle },
    blank: { color: p.text.secondary, background: "transparent", border: `1px dashed ${p.border.default}` },
  };
}

const CELL_SX = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "calc(30rem / 15)",
  height: "calc(26rem / 15)",
  borderRadius: "calc(6rem / 15)",
  fontWeight: 700,
  fontSize: "calc(11rem / 15)",
  boxSizing: "border-box",
};

/** One legend swatch: the cell as it appears in the grid, then its word. */
export function Swatch({ code }) {
  const tones = useTones();
  const def = CELL[code];
  return (
    <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: "calc(6rem / 15)", fontSize: "calc(12rem / 15)" }}>
      <Box component="span" aria-hidden sx={{ ...CELL_SX, ...tones[def.tone] }}>{code === "late" ? "14" : def.text}</Box>
      {code === "late" ? "Late (minutes)" : pick(def.label, { lateMin: 0 })}
    </Box>
  );
}

export default function AttendanceGrid({ days, rows, onCellClick }) {
  const p = useTheme().tokens;
  const tones = useTones();
  const th = { padding: "calc(6rem / 15) calc(4rem / 15)", fontWeight: 600, fontSize: "calc(12rem / 15)", color: p.text.secondary, whiteSpace: "nowrap" };
  const sticky = { position: "sticky", left: 0, zIndex: 1, background: p.surface.card };
  const total = { ...th, textAlign: "right", paddingLeft: "calc(12rem / 15)" };

  return (
    <Box sx={{ overflowX: "auto", maxWidth: "100%" }} data-testid="attendance-grid">
      <Box component="table" sx={{ borderCollapse: "collapse", fontSize: "calc(13rem / 15)" }}>
        <thead>
          <tr>
            <Box component="th" scope="col" sx={{ ...th, ...sticky, textAlign: "left", minWidth: "calc(150rem / 15)" }}>Person</Box>
            {days.map((d) => (
              <Box component="th" scope="col" key={d} sx={{ ...th, textAlign: "center", minWidth: "calc(34rem / 15)" }}>
                <Box sx={{ color: p.text.primary }}>{dayjs(d).format("D")}</Box>
                <Box sx={{ fontSize: "calc(10rem / 15)", fontWeight: 500 }}>{dayjs(d).format("dd")}</Box>
              </Box>
            ))}
            <Box component="th" scope="col" sx={total}>Present</Box>
            <Box component="th" scope="col" sx={total}>Late</Box>
            <Box component="th" scope="col" sx={total}>Absent</Box>
            <Box component="th" scope="col" sx={total}>Left early</Box>
            <Box component="th" scope="col" sx={total}>Online / shift</Box>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Box component="tr" key={r.UserId} data-testid={`att-totals-${r.UserId}`} sx={{ borderTop: `1px solid ${p.border.subtle}` }}>
              <Box component="th" scope="row" sx={{ ...th, ...sticky, textAlign: "left", color: p.text.primary }}>
                <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: "calc(6rem / 15)" }}>
                  {r.FullName}
                  {r.LateStreak && (
                    <Box
                      component="span"
                      role="img"
                      aria-label="Late 3 working days in a row"
                      title="Late 3 working days in a row"
                      sx={{ width: "calc(8rem / 15)", height: "calc(8rem / 15)", borderRadius: "50%", background: p.error.main, flexShrink: 0 }}
                    />
                  )}
                </Box>
              </Box>
              {r.cells.map((c) => {
                const def = CELL[c.code] ?? CELL.future;
                const label = `${cellLabel(c)}, ${r.FullName}, ${dayjs(c.date).format("ddd D MMM")}`;
                const clickable = onCellClick && !NOT_A_DAY.has(c.code);
                return (
                  <Box component="td" key={c.date} sx={{ padding: "calc(3rem / 15) calc(2rem / 15)", textAlign: "center" }}>
                    <Box
                      component={clickable ? "button" : "span"}
                      {...(clickable && { type: "button", onClick: () => onCellClick(r, c.date) })}
                      aria-label={label}
                      title={label}
                      data-code={c.code}
                      sx={{
                        ...CELL_SX,
                        ...tones[def.tone],
                        ...(clickable && {
                          border: "none",
                          cursor: "pointer",
                          fontFamily: "inherit",
                          "&:hover": { outline: `2px solid ${p.border.strong}` },
                          "&:focus-visible": { outline: `2px solid ${p.border.focus}`, outlineOffset: "calc(1rem / 15)" },
                        }),
                      }}
                    >
                      {pick(def.text, c)}
                    </Box>
                  </Box>
                );
              })}
              <Box component="td" sx={total} data-testid="att-present">
                <Box component="span" sx={{ color: p.text.primary, fontWeight: 700 }}>{halves(r.Present)}</Box> / {halves(r.WorkingDays)}
              </Box>
              <Box component="td" sx={{ ...total, ...(r.Late > 0 && { color: p.warning.text, fontWeight: 700 }) }} data-testid="att-late">{r.Late}</Box>
              <Box component="td" sx={{ ...total, ...(r.Absent > 0 && { color: p.error.hover, fontWeight: 700 }) }} data-testid="att-absent">{r.Absent}</Box>
              <Box component="td" sx={total} data-testid="att-early">{r.LeftEarly}</Box>
              <Box component="td" sx={total} data-testid="att-hours">
                {r.OnlineMedianMin == null ? "—" : `${mins(r.OnlineMedianMin)} / ${mins(r.ShiftMedianMin)}`}
              </Box>
            </Box>
          ))}
        </tbody>
      </Box>
    </Box>
  );
}
