import { useTheme } from "@mui/material/styles";
import { Box, Typography } from "@mui/material";
import { ArrowUpRight, ArrowDownRight, Target } from "lucide-react";
import {
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
} from "recharts";

/**
 * Single-metric goal ring with context — current value, goal, delta vs
 * previous period, and a secondary stat row underneath.
 */
export default function RadialGoal({
  value = 62,
  goal = 100,
  previousValue = 54,
  label = "Conversion rate",
  suffix = "%",
  secondary = [
    { label: "Target", value: "100%" },
    { label: "Last week", value: "54%" },
  ],
  height = 220,
}) {
  const theme = useTheme();
  const p = theme.tokens;
  const pct = Math.max(0, Math.min(goal, value));
  const delta = value - previousValue;
  const up = delta >= 0;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
          <Target size={14} style={{ color: p.primary.main }} />
          <Typography sx={{ fontSize: "0.8rem", fontWeight: 600, color: "text.primary" }}>
            {label}
          </Typography>
        </Box>
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
          {Math.abs(delta)}
          {suffix}
        </Box>
      </Box>

      <Box sx={{ position: "relative", height }}>
        <ResponsiveContainer width="100%" height={height}>
          <RadialBarChart
            innerRadius="72%"
            outerRadius="96%"
            data={[{ name: label, value: pct, fill: p.primary.main }]}
            startAngle={90}
            endAngle={-270}
          >
            <defs>
              <linearGradient id="goalGradient" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={p.primary.main} stopOpacity={1} />
                <stop offset="100%" stopColor={p.accent.main} stopOpacity={1} />
              </linearGradient>
            </defs>
            <PolarAngleAxis
              type="number"
              domain={[0, goal]}
              angleAxisId={0}
              tick={false}
            />
            <RadialBar
              background={{ fill: p.surface.subtle }}
              dataKey="value"
              cornerRadius={999}
              fill="url(#goalGradient)"
            />
          </RadialBarChart>
        </ResponsiveContainer>
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <Typography
            sx={{
              fontSize: "2rem",
              fontWeight: 700,
              color: "text.primary",
              lineHeight: 1,
            }}
          >
            {value}
            <span style={{ fontSize: "1rem", color: p.text.tertiary }}>
              {suffix}
            </span>
          </Typography>
          <Typography
            sx={{ fontSize: "0.7rem", color: "text.tertiary", mt: 0.5, textAlign: "center" }}
          >
            of {goal}
            {suffix} goal
          </Typography>
        </Box>
      </Box>

      {secondary?.length ? (
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-around",
            gap: 1,
            pt: 1,
            borderTop: `1px solid ${p.border.subtle}`,
          }}
        >
          {secondary.map((s) => (
            <Box key={s.label} sx={{ textAlign: "center" }}>
              <Typography
                sx={{ fontSize: "0.65rem", color: "text.tertiary", letterSpacing: "0.04em", textTransform: "uppercase" }}
              >
                {s.label}
              </Typography>
              <Typography sx={{ fontSize: "0.85rem", fontWeight: 700 }}>
                {s.value}
              </Typography>
            </Box>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}
