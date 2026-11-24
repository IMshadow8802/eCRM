import { useTheme } from "@mui/material/styles";
import useUiScale from "../../hooks/useUiScale";
import { Box } from "@mui/material";
import ChartEmpty from "./ChartEmpty";
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
export default function ActivityBar({ data, height = 240 }) {
  const theme = useTheme();
  const k = useUiScale();
  const p = theme.tokens;
  const hasData = Array.isArray(data) && data.length > 0;
  if (!hasData) return <ChartEmpty height={height * k} />;
  const rows = data;

  return (
    <Box sx={{ position: "relative" }}>
      <ResponsiveContainer width="100%" height={height * k}>
        <BarChart data={rows} margin={{ top: 6 * k, right: 8 * k, left: 0, bottom: 0 }}>
        <CartesianGrid
          stroke={p.border.subtle}
          strokeDasharray="3 3"
          vertical={false}
        />
        <XAxis
          dataKey="name"
          tick={{ fill: p.text.tertiary, fontSize: 11 * k }}
          stroke={p.border.default}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fill: p.text.tertiary, fontSize: 11 * k }}
          stroke={p.border.default}
          tickLine={false}
          axisLine={false}
          width={32 * k}
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
          wrapperStyle={{ fontSize: "calc(11rem / 15)", color: p.text.secondary }}
        />
        <Bar dataKey="leads" name="Leads" fill={p.primary.main} radius={[8 * k, 8 * k, 0, 0]} />
        <Bar dataKey="calls" name="Calls" fill={p.accent.main} radius={[8 * k, 8 * k, 0, 0]} />
        <Bar dataKey="tickets" name="Tickets" fill={p.warning.main} radius={[8 * k, 8 * k, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </Box>
  );
}
