// src/pages/Reports/sales/SummaryTable.jsx
//
// One summary: a line per person / source / reason, a Total row, and the
// previous period under it. Every non-zero number with rows behind it is a
// link in its colour-key hue; a zero is a plain grey 0. Plain MUI table
// (plan ruling 8): two footer rows, a section row and skeleton rows are not
// expressible in material-react-table.
import { Link } from "react-router-dom";
import { Table, TableBody, TableCell, TableContainer, TableFooter, TableHead, TableRow } from "@mui/material";
import { useTheme } from "@mui/material/styles";

import { Skeleton, Tooltip } from "../../../components/ui";
import { keyInk, reportKey } from "../../../styles/tokens";
import { formatCurrency } from "../../../utils/format";
import { diffOf, previousLabel } from "./salesReportUtils";

const fs = (px) => `calc(${px}rem / 15)`;
const SKELETON_ROWS = 6;

function formatNumber(column, v) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "—";
  if (!Number(v)) return "0";
  switch (column.format) {
    case "money": return formatCurrency(v);
    case "pct": return `${Number(v).toFixed(1)}%`;
    case "days": return Number(v).toFixed(1);
    default: return Number(v).toLocaleString("en-IN");
  }
}

function NumberCell({ column, line, totals, href, p }) {
  const v = column.value(line, totals);
  const text = formatNumber(column, v);
  if (text === "0") return <span style={{ color: p.text.tertiary }}>0</span>;
  if (!href || text === "—") return text;
  return (
    <Link
      to={href}
      style={{
        color: keyInk(p, column.k),
        fontWeight: "inherit",
        textDecoration: "underline",
        textDecorationColor: reportKey[column.k].underline,
        textDecorationThickness: "1px",
        textUnderlineOffset: "3px",
      }}
    >
      {text}
    </Link>
  );
}

// "▲ +79" better, "▼ +312" worse, the bare "+229" when a rise is neither.
function Difference({ column, now, before, p }) {
  const d = diffOf(now, before, column.goodUp);
  if (!d.text) return null;
  const text = column.format === "money" ? `${d.text[0]}₹${d.text.slice(1)}` : d.text;
  const [arrow, color] = { better: ["▲ ", reportKey.better], worse: ["▼ ", reportKey.worse], flat: ["", p.text.tertiary] }[d.tone];
  return <span style={{ display: "block", fontSize: fs(12), fontWeight: 600, color }}>{arrow + text}</span>;
}

export default function SummaryTable({
  firstHeader,
  columns,
  lines,
  totals,
  previous,
  loading = false,
  nameCell,
  cellHref,
  sectionBefore = () => null,
  "data-testid": testId,
}) {
  const theme = useTheme();
  const p = theme.tokens;
  const span = columns.length + 1;
  const totalLine = { LineKind: "total", ...totals };

  const cell = { fontSize: fs(14), fontWeight: 500, py: fs(8), px: fs(12), whiteSpace: "nowrap", borderBottom: `1px solid ${p.border.subtle}` };
  const num = { ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" };
  // The first column stays put while the numbers scroll sideways.
  const first = (background) => ({ position: "sticky", left: 0, zIndex: 1, background });
  const head = {
    ...cell, fontSize: fs(12), fontWeight: 600, color: p.text.secondary, textTransform: "uppercase", letterSpacing: "0.03em",
    background: p.surface.card, verticalAlign: "bottom", borderBottom: `1px solid ${p.border.default}`,
  };
  const foot = { ...num, color: p.text.primary, borderBottom: 0, borderTop: `1px solid ${p.border.default}` };

  return (
    <TableContainer sx={{ overflow: "auto", maxHeight: "100%" }} data-testid={testId}>
      <Table stickyHeader size="small" sx={{ "& tbody tr:hover td": { background: p.surface.hover } }}>
        <TableHead>
          <TableRow>
            <TableCell sx={{ ...head, ...first(p.surface.card), zIndex: 3 }}>{firstHeader}</TableCell>
            {columns.map((c) => (
              <TableCell key={c.key} sx={{ ...head, textAlign: "right" }}>
                <span
                  data-key={c.k}
                  aria-hidden
                  style={{
                    display: "inline-block", width: fs(7), height: fs(7), borderRadius: "50%", marginRight: fs(5),
                    verticalAlign: "middle", position: "relative", top: -1, background: reportKey[c.k].dot ?? reportKey[c.k].text,
                  }}
                />
                <Tooltip title={c.hint}>
                  <span style={{ borderBottom: `1px dotted ${p.text.tertiary}`, cursor: "help" }}>{c.header}</span>
                </Tooltip>
                {c.now && (
                  <span style={{ display: "block", textTransform: "none", letterSpacing: 0, fontWeight: 500, color: p.text.tertiary, fontSize: fs(11) }}>
                    now
                  </span>
                )}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>

        <TableBody sx={{ background: p.surface.card }}>
          {loading
            ? Array.from({ length: SKELETON_ROWS }, (_, i) => (
                <TableRow key={i} data-testid="summary-skeleton-row">
                  <TableCell sx={{ ...cell, ...first(p.surface.card) }}><Skeleton variant="text" width={`${[62, 48, 70, 55, 40, 66][i]}%`} /></TableCell>
                  {columns.map((c) => (
                    <TableCell key={c.key} sx={num}><Skeleton variant="text" width={fs(28)} style={{ marginLeft: "auto" }} /></TableCell>
                  ))}
                </TableRow>
              ))
            : lines.flatMap((l, i) => {
                const section = sectionBefore(l);
                const row = (
                  <TableRow key={`l${i}`}>
                    <TableCell sx={{ ...cell, ...first(p.surface.card) }}>{nameCell(l)}</TableCell>
                    {columns.map((c) => (
                      <TableCell key={c.key} sx={num}>
                        <NumberCell column={c} line={l} totals={totals} href={cellHref(l, c)} p={p} />
                      </TableCell>
                    ))}
                  </TableRow>
                );
                if (!section) return [row];
                return [
                  <TableRow key={`s${i}`}>
                    <TableCell
                      colSpan={span}
                      sx={{ ...cell, py: fs(6), background: p.surface.page, fontSize: fs(12), fontWeight: 600, color: p.text.secondary, textTransform: "uppercase", letterSpacing: "0.03em" }}
                    >
                      {section}
                    </TableCell>
                  </TableRow>,
                  row,
                ];
              })}
        </TableBody>

        {!loading && (
          <TableFooter>
            <TableRow sx={{ background: p.surface.subtle }}>
              <TableCell sx={{ ...foot, ...first(p.surface.subtle), textAlign: "left", fontWeight: 700 }}>Total</TableCell>
              {columns.map((c) => (
                <TableCell key={c.key} sx={{ ...foot, fontWeight: 700 }}>
                  <NumberCell column={c} line={totalLine} totals={totals} href={cellHref(totalLine, c)} p={p} />
                </TableCell>
              ))}
            </TableRow>
            {previous && (
              <TableRow sx={{ background: p.surface.card }}>
                <TableCell sx={{ ...foot, ...first(p.surface.card), textAlign: "left", fontSize: fs(13), color: p.text.secondary }}>
                  {previousLabel(previous.range)}
                </TableCell>
                {columns.map((c) => {
                  if (c.now) return <TableCell key={c.key} sx={{ ...foot, fontSize: fs(13), color: p.text.secondary }}>—</TableCell>;
                  const before = c.value(previous.totals, previous.totals);
                  return (
                    <TableCell key={c.key} sx={{ ...foot, fontSize: fs(13), color: p.text.secondary }}>
                      {formatNumber(c, before)}
                      <Difference column={c} now={c.value(totals, totals)} before={before} p={p} />
                    </TableCell>
                  );
                })}
              </TableRow>
            )}
          </TableFooter>
        )}
      </Table>
    </TableContainer>
  );
}
