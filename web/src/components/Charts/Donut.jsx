import { useTheme } from "@mui/material/styles";
import {
  Cell,
  Legend,
  Pie,
  PieChart as RechartsPie,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

/**
 * Donut chart (recharts). Colorful palette pulled from design tokens.
 * Pass `data: [{name, value}]` or falls back to a demo series.
 */
const FALLBACK = [
  { name: "Google", value: 42 },
  { name: "Direct", value: 28 },
  { name: "Email", value: 18 },
  { name: "Referral", value: 12 },
  { name: "Social", value: 9 },
];

export default function Donut({ data, height = 240, variant = "donut" }) {
  const theme = useTheme();
  const p = theme.tokens;
  const rows = Array.isArray(data) && data.length ? data : FALLBACK;

  const palette = [
    p.primary.main,
    p.accent.main,
    p.success.main,
    p.warning.main,
    p.info.main,
    p.error.main,
  ];

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsPie>
        <Pie
          data={rows}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius={variant === "donut" ? "54%" : 0}
          outerRadius="86%"
          paddingAngle={variant === "donut" ? 2 : 0}
          stroke={p.surface.card}
          strokeWidth={2}
        >
          {rows.map((_, idx) => (
            <Cell key={idx} fill={palette[idx % palette.length]} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            background: p.surface.card,
            border: `1px solid ${p.border.default}`,
            borderRadius: 8,
            fontSize: 12,
            color: p.text.primary,
          }}
          itemStyle={{ color: p.text.primary }}
        />
        <Legend
          verticalAlign="bottom"
          height={24}
          iconType="circle"
          wrapperStyle={{ fontSize: 11, color: p.text.secondary }}
        />
      </RechartsPie>
    </ResponsiveContainer>
  );
}
