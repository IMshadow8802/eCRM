import { useTheme } from "@mui/material/styles";
import useUiScale from "../../hooks/useUiScale";
import { Box } from "@mui/material";
import ChartEmpty from "./ChartEmpty";
import {
  Funnel as RechartsFunnel,
  FunnelChart as RechartsFunnelChart,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  Cell,
} from "recharts";

export default function Funnel({ data, height = 240 }) {
  const theme = useTheme();
  const k = useUiScale();
  const p = theme.tokens;
  const hasData = Array.isArray(data) && data.length > 0;
  if (!hasData) return <ChartEmpty height={height * k} />;
  const rows = data;
  const palette = [
    p.primary.main,
    p.info.main,
    p.success.main,
    p.warning.main,
    p.accent.main,
    p.error.main,
  ];

  return (
    <Box sx={{ position: "relative" }}>
      <ResponsiveContainer width="100%" height={height * k}>
        <RechartsFunnelChart>
        <Tooltip
          contentStyle={{
            background: p.surface.card,
            border: `1px solid ${p.border.default}`,
            borderRadius: 8,
            fontSize: 12,
            color: p.text.primary,
          }}
        />
        <RechartsFunnel dataKey="value" data={rows} isAnimationActive>
          {rows.map((_, idx) => (
            <Cell key={idx} fill={palette[idx % palette.length]} />
          ))}
          <LabelList
            position="right"
            fill={p.text.primary}
            stroke="none"
            dataKey="name"
            style={{ fontSize: 12 * k, fontWeight: 600 }}
          />
        </RechartsFunnel>
        </RechartsFunnelChart>
      </ResponsiveContainer>
    </Box>
  );
}
