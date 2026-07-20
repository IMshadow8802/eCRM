import { useTheme } from "@mui/material/styles";
import { Box } from "@mui/material";
import SampleBadge from "./SampleBadge";
import {
  Funnel as RechartsFunnel,
  FunnelChart as RechartsFunnelChart,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  Cell,
} from "recharts";

const FALLBACK = [
  { name: "Visit", value: 1200 },
  { name: "Inquiry", value: 780 },
  { name: "Order", value: 420 },
  { name: "Click", value: 260 },
  { name: "Show", value: 140 },
];

export default function Funnel({ data, height = 240 }) {
  const theme = useTheme();
  const p = theme.tokens;
  const hasData = Array.isArray(data) && data.length > 0;
  const rows = hasData ? data : FALLBACK;
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
      {!hasData && <SampleBadge />}
      <ResponsiveContainer width="100%" height={height}>
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
            style={{ fontSize: 12, fontWeight: 600 }}
          />
        </RechartsFunnel>
        </RechartsFunnelChart>
      </ResponsiveContainer>
    </Box>
  );
}
