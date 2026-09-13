import { useTheme } from "@mui/material/styles";
import { Box, Typography } from "@mui/material";
import dayjs from "dayjs";
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
 * Generic multi-series area chart for the report frame.
 *
 * AreaTrend (dashboard) is wired to the leads/converted keys with a
 * sample-data fallback and its own KPI strip; this one draws whatever
 * `series` names, with theme tones so it follows dark mode.
 *   series: [{ key, label, tone }]  tone ∈ primary|accent|success|warning|error|info
 */
export default function TrendArea({
  data = [],
  xKey = "Bucket",
  series = [],
  height = 240,
  "data-testid": testId = "trend-area",
}) {
  const theme = useTheme();
  const p = theme.tokens;
  const tone = (t) => (p[t] ?? p.primary).main;
  const axis = {
    tick: { fill: p.text.tertiary, fontSize: 11 },
    stroke: p.border.default,
    tickLine: false,
    axisLine: false,
  };
  // Buckets are dates for day/week/month grouping and plain labels otherwise.
  const fmtX = (v) => (dayjs(v).isValid() ? dayjs(v).format("DD MMM") : String(v));

  return (
    <Box data-testid={testId}>
      <Box sx={{ display: "flex", gap: 2, mb: 1, flexWrap: "wrap" }}>
        {series.map((s) => (
          <Box key={s.key} sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
            <Box
              sx={{ width: 10, height: 10, borderRadius: 999, backgroundColor: tone(s.tone) }}
            />
            <Typography
              sx={{ fontSize: "0.7333rem", color: "text.secondary" }}
              data-testid={`${testId}-legend-${s.key}`}
            >
              {s.label}
            </Typography>
          </Box>
        ))}
      </Box>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`${testId}-grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={tone(s.tone)} stopOpacity={0.45} />
                <stop offset="100%" stopColor={tone(s.tone)} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid stroke={p.border.subtle} strokeDasharray="4 4" vertical={false} />
          <XAxis dataKey={xKey} tickFormatter={fmtX} {...axis} />
          <YAxis {...axis} width={40} allowDecimals={false} />
          <Tooltip
            labelFormatter={fmtX}
            contentStyle={{
              background: p.surface.card,
              border: `1px solid ${p.border.default}`,
              borderRadius: 8,
              fontSize: 12,
              color: p.text.primary,
            }}
            cursor={{ stroke: p.border.strong }}
          />
          {series.map((s) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={tone(s.tone)}
              strokeWidth={2}
              fill={`url(#${testId}-grad-${s.key})`}
              dot={false}
              activeDot={{ r: 4 }}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </Box>
  );
}
