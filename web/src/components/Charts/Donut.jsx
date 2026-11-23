import { useTheme } from "@mui/material/styles";
import useUiScale from "../../hooks/useUiScale";
import { Box } from "@mui/material";
import ChartEmpty from "./ChartEmpty";
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
 * Pass `data: [{name, value}]`; renders ChartEmpty without it.
 */
export default function Donut({ data, height = 240, variant = "donut" }) {
  const theme = useTheme();
  const k = useUiScale();
  const p = theme.tokens;
  const hasData = Array.isArray(data) && data.length > 0;
  if (!hasData) return <ChartEmpty height={height * k} />;
  const rows = data;

  const palette = [
    p.primary.main,
    p.accent.main,
    p.success.main,
    p.warning.main,
    p.info.main,
    p.error.main,
  ];

  return (
    <Box sx={{ position: "relative" }}>
      <ResponsiveContainer width="100%" height={height * k}>
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
          height={24 * k}
          iconType="circle"
          wrapperStyle={{ fontSize: "calc(11rem / 15)", color: p.text.secondary }}
        />
      </RechartsPie>
      </ResponsiveContainer>
    </Box>
  );
}
