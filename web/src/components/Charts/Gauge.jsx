import { useTheme } from "@mui/material/styles";
import { Box, Typography } from "@mui/material";
import {
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
} from "recharts";

/**
 * Half-circle gauge — great for "alert"-style metrics (missed follow-ups,
 * SLA breach %). Color shifts red above threshold.
 */
export default function Gauge({
  label = "Missed follow-ups",
  value = 8,
  max = 50,
  warnAt = 0.3,
  dangerAt = 0.6,
  unit = "",
  height = 96,
}) {
  const theme = useTheme();
  const p = theme.tokens;
  const ratio = Math.max(0, Math.min(1, value / max));
  const color =
    ratio >= dangerAt
      ? p.error.main
      : ratio >= warnAt
        ? p.warning.main
        : p.success.main;
  const data = [{ name: label, value, fill: color }];

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Typography sx={{ fontSize: "0.7333rem", color: "text.secondary" }}>
        {label}
      </Typography>
      <Box sx={{ position: "relative", height }}>
        <ResponsiveContainer width="100%" height={height}>
          <RadialBarChart
            innerRadius="70%"
            outerRadius="100%"
            data={data}
            startAngle={180}
            endAngle={0}
            cy="85%"
          >
            <PolarAngleAxis
              type="number"
              domain={[0, max]}
              angleAxisId={0}
              tick={false}
            />
            <RadialBar
              background={{ fill: p.surface.subtle }}
              dataKey="value"
              cornerRadius={999}
            />
          </RadialBarChart>
        </ResponsiveContainer>
        <Box
          sx={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: "8%",
            textAlign: "center",
          }}
        >
          <Typography
            sx={{ fontSize: "1.5rem", fontWeight: 700, lineHeight: 1, color }}
          >
            {value}
            {unit && (
              <span style={{ fontSize: "0.8rem", color: p.text.tertiary, marginLeft: 4 }}>
                {unit}
              </span>
            )}
          </Typography>
          <Typography
            sx={{ fontSize: "0.65rem", color: "text.tertiary", mt: 0.25 }}
          >
            of {max}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}
