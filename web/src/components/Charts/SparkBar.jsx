import { useTheme } from "@mui/material/styles";
import { Box, Typography } from "@mui/material";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip } from "recharts";

/**
 * Compact sparkline bar card. Label + current value on top, bars below.
 * Last bar highlighted so the eye lands on "today" / latest bucket.
 */
const FALLBACK = [3, 7, 5, 11, 8, 13, 9, 14, 12, 17, 15, 19];

export default function SparkBar({
  label = "Leads this week",
  value,
  data,
  tone = "primary",
  height = 64,
}) {
  const theme = useTheme();
  const p = theme.tokens;
  const series = Array.isArray(data) && data.length ? data : FALLBACK;
  const rows = series.map((v, i) => ({ i, v }));
  const total = value ?? series.reduce((a, b) => a + b, 0);
  const color = p[tone]?.main ?? p.primary.main;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
      <Box
        sx={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
        }}
      >
        <Typography sx={{ fontSize: "0.7333rem", color: "text.secondary" }}>
          {label}
        </Typography>
        <Typography sx={{ fontSize: "1.1rem", fontWeight: 700 }}>
          {total}
        </Typography>
      </Box>
      <Box sx={{ width: "100%", height }}>
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={rows} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
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
              cursor={{ fill: p.surface.subtle }}
            />
            <Bar dataKey="v" radius={[3, 3, 0, 0]}>
              {rows.map((row, idx) => (
                <Cell
                  key={idx}
                  fill={idx === rows.length - 1 ? color : `${color}66`}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Box>
    </Box>
  );
}
