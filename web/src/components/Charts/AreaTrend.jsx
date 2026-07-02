import { useTheme } from "@mui/material/styles";
import { Box, Typography } from "@mui/material";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * Hero area chart with inline KPI summary. Two series (Leads, Converted)
 * with gradient fills + floating totals and week-over-week delta chips.
 */
const FALLBACK = [
  { name: "Mon", leads: 18, converted: 6 },
  { name: "Tue", leads: 26, converted: 9 },
  { name: "Wed", leads: 22, converted: 11 },
  { name: "Thu", leads: 31, converted: 14 },
  { name: "Fri", leads: 28, converted: 16 },
  { name: "Sat", leads: 20, converted: 10 },
  { name: "Sun", leads: 24, converted: 12 },
];

const DeltaChip = ({ delta, tone }) => {
  const theme = useTheme();
  const p = theme.tokens;
  const up = delta >= 0;
  const tonePalette = p[tone] ?? p.primary;
  return (
    <Box
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.25,
        px: 0.75,
        py: 0.25,
        borderRadius: 999,
        backgroundColor: up ? p.success.subtle : p.error.subtle,
        color: up ? p.success.main : p.error.main,
        fontSize: "0.7rem",
        fontWeight: 600,
      }}
    >
      {up ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
      {Math.abs(delta).toFixed(0)}%
    </Box>
  );
};

const LegendDot = ({ color, label, value }) => (
  <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
    <Box sx={{ width: 10, height: 10, borderRadius: 999, backgroundColor: color }} />
    <Typography sx={{ fontSize: "0.7333rem", color: "text.secondary" }}>
      {label}
    </Typography>
    <Typography sx={{ fontSize: "0.8rem", fontWeight: 700 }}>{value}</Typography>
  </Box>
);

export default function AreaTrend({ data, height = 240 }) {
  const theme = useTheme();
  const p = theme.tokens;
  const rows = Array.isArray(data) && data.length ? data : FALLBACK;

  const totalLeads = rows.reduce((s, r) => s + (r.leads ?? 0), 0);
  const totalConv = rows.reduce((s, r) => s + (r.converted ?? 0), 0);
  const deltaLeads =
    rows.length > 1
      ? ((rows[rows.length - 1].leads - rows[0].leads) / (rows[0].leads || 1)) * 100
      : 0;
  const deltaConv =
    rows.length > 1
      ? ((rows[rows.length - 1].converted - rows[0].converted) /
          (rows[0].converted || 1)) *
        100
      : 0;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", gap: 1 }}>
      {/* Inline KPI strip */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 1.5,
        }}
      >
        <Box sx={{ display: "flex", gap: 3, alignItems: "center" }}>
          <Box>
            <Box sx={{ display: "flex", alignItems: "baseline", gap: 1 }}>
              <Typography
                sx={{ fontSize: "1.6rem", fontWeight: 700, color: "text.primary", lineHeight: 1 }}
              >
                {totalLeads}
              </Typography>
              <DeltaChip delta={deltaLeads} tone="primary" />
            </Box>
            <Typography sx={{ fontSize: "0.7333rem", color: "text.tertiary" }}>
              Leads
            </Typography>
          </Box>
          <Box>
            <Box sx={{ display: "flex", alignItems: "baseline", gap: 1 }}>
              <Typography
                sx={{ fontSize: "1.6rem", fontWeight: 700, color: "text.primary", lineHeight: 1 }}
              >
                {totalConv}
              </Typography>
              <DeltaChip delta={deltaConv} tone="accent" />
            </Box>
            <Typography sx={{ fontSize: "0.7333rem", color: "text.tertiary" }}>
              Converted
            </Typography>
          </Box>
        </Box>
        <Box sx={{ display: "flex", gap: 2 }}>
          <LegendDot color={p.primary.main} label="Leads" value={totalLeads} />
          <LegendDot color={p.accent.main} label="Converted" value={totalConv} />
        </Box>
      </Box>

      {/* Chart */}
      <Box sx={{ height }}>
        <ResponsiveContainer width="100%" height={height}>
          <AreaChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="leadsGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={p.primary.main} stopOpacity={0.55} />
                <stop offset="100%" stopColor={p.primary.main} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="convGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={p.accent.main} stopOpacity={0.45} />
                <stop offset="100%" stopColor={p.accent.main} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              stroke={p.border.subtle}
              strokeDasharray="4 4"
              vertical={false}
            />
            <XAxis
              dataKey="name"
              tick={{ fill: p.text.tertiary, fontSize: 11 }}
              stroke={p.border.default}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tick={{ fill: p.text.tertiary, fontSize: 11 }}
              stroke={p.border.default}
              tickLine={false}
              axisLine={false}
              width={32}
            />
            <Tooltip
              contentStyle={{
                background: p.surface.card,
                border: `1px solid ${p.border.default}`,
                borderRadius: 8,
                fontSize: 12,
                color: p.text.primary,
              }}
              labelStyle={{ color: p.text.secondary, marginBottom: 4 }}
              cursor={{ stroke: p.border.strong }}
            />
            <Area
              type="monotone"
              dataKey="leads"
              name="Leads"
              stroke={p.primary.main}
              strokeWidth={2.5}
              fill="url(#leadsGradient)"
              dot={{ r: 3, fill: p.primary.main, strokeWidth: 0 }}
              activeDot={{ r: 5, fill: p.primary.main, stroke: p.surface.card, strokeWidth: 2 }}
            />
            <Area
              type="monotone"
              dataKey="converted"
              name="Converted"
              stroke={p.accent.main}
              strokeWidth={2.5}
              fill="url(#convGradient)"
              dot={{ r: 3, fill: p.accent.main, strokeWidth: 0 }}
              activeDot={{ r: 5, fill: p.accent.main, stroke: p.surface.card, strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </Box>
    </Box>
  );
}
