import { useTheme } from "@mui/material/styles";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * Quarterly / period-over-period grouped bar chart. 3–4 series.
 */
const FALLBACK = [
  { name: "Q1", leads: 320, converted: 120, lost: 48 },
  { name: "Q2", leads: 410, converted: 168, lost: 62 },
  { name: "Q3", leads: 380, converted: 154, lost: 58 },
  { name: "Q4", leads: 460, converted: 196, lost: 70 },
];

export default function ActivityBar({ data, height = 240 }) {
  const theme = useTheme();
  const p = theme.tokens;
  const rows = Array.isArray(data) && data.length ? data : FALLBACK;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid
          stroke={p.border.subtle}
          strokeDasharray="3 3"
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
          cursor={{ fill: p.surface.subtle }}
        />
        <Legend
          iconType="circle"
          wrapperStyle={{ fontSize: 11, color: p.text.secondary }}
        />
        <Bar dataKey="leads" name="Leads" fill={p.primary.main} radius={[8, 8, 0, 0]} />
        <Bar dataKey="converted" name="Converted" fill={p.accent.main} radius={[8, 8, 0, 0]} />
        <Bar dataKey="lost" name="Lost" fill={p.warning.main} radius={[8, 8, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
