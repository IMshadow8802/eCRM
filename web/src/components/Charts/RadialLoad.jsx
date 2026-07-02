import { useTheme } from "@mui/material/styles";
import {
  Legend,
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

/**
 * Multi-series radial bars — useful for weekday load / channel mix.
 * Each series renders concentric rings.
 */
const FALLBACK = [
  { name: "Calls", value: 82 },
  { name: "Emails", value: 64 },
  { name: "Demos", value: 48 },
  { name: "Visits", value: 30 },
];

export default function RadialLoad({ data, height = 240 }) {
  const theme = useTheme();
  const p = theme.tokens;
  const rows = Array.isArray(data) && data.length ? data : FALLBACK;
  const palette = [
    p.primary.main,
    p.accent.main,
    p.success.main,
    p.warning.main,
    p.info.main,
  ];
  const colored = rows.map((row, idx) => ({
    ...row,
    fill: palette[idx % palette.length],
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RadialBarChart
        innerRadius="30%"
        outerRadius="95%"
        data={colored}
        startAngle={90}
        endAngle={-270}
      >
        <PolarAngleAxis
          type="number"
          domain={[0, 100]}
          angleAxisId={0}
          tick={false}
        />
        <RadialBar
          background={{ fill: p.surface.subtle }}
          dataKey="value"
          cornerRadius={999}
        />
        <Tooltip
          contentStyle={{
            background: p.surface.card,
            border: `1px solid ${p.border.default}`,
            borderRadius: 8,
            fontSize: 12,
            color: p.text.primary,
          }}
        />
        <Legend
          iconType="circle"
          wrapperStyle={{ fontSize: 11, color: p.text.secondary }}
          verticalAlign="bottom"
          height={24}
        />
      </RadialBarChart>
    </ResponsiveContainer>
  );
}
