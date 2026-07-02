import { useTheme } from "@mui/material/styles";
import { Box, Typography } from "@mui/material";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

/**
 * Compact line+area sparkline card. Shows label, big value, delta chip,
 * gradient area trend underneath.
 */
const FALLBACK = [12, 14, 11, 18, 15, 22, 19, 25, 23, 29, 27, 34];

export default function SparkLine({
  label = "Follow-ups this week",
  value,
  data,
  tone = "primary",
  height = 56,
  unit = "",
}) {
  const theme = useTheme();
  const p = theme.tokens;
  const series = Array.isArray(data) && data.length ? data : FALLBACK;
  const rows = series.map((v, i) => ({ i, v }));
  const total = value ?? series[series.length - 1];
  const color = p[tone]?.main ?? p.primary.main;
  const delta =
    series.length > 1
      ? ((series[series.length - 1] - series[0]) / (series[0] || 1)) * 100
      : 0;
  const up = delta >= 0;
  const gradId = `sl-${tone}`;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Box
        sx={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 1,
        }}
      >
        <Typography sx={{ fontSize: "0.7333rem", color: "text.secondary" }}>
          {label}
        </Typography>
        <Box
          sx={{
            display: "inline-flex",
            alignItems: "center",
            gap: 0.5,
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
      </Box>
      <Typography
        sx={{ fontSize: "1.5rem", fontWeight: 700, color: "text.primary", lineHeight: 1.2 }}
      >
        {total}
        {unit && (
          <span style={{ fontSize: "0.8rem", color: p.text.tertiary, marginLeft: 4 }}>
            {unit}
          </span>
        )}
      </Typography>
      <Box sx={{ height, mt: 0.5 }}>
        <ResponsiveContainer width="100%" height={height}>
          <AreaChart data={rows} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.45} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Tooltip
              contentStyle={{
                background: p.surface.card,
                border: `1px solid ${p.border.default}`,
                borderRadius: 6,
                fontSize: 11,
                padding: "4px 8px",
              }}
              labelFormatter={() => ""}
              formatter={(v) => [v, ""]}
              cursor={{ stroke: p.border.strong }}
            />
            <Area
              type="monotone"
              dataKey="v"
              stroke={color}
              strokeWidth={2}
              fill={`url(#${gradId})`}
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </Box>
    </Box>
  );
}
