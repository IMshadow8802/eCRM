import { useTheme } from "@mui/material/styles";

import { rem } from "../../utils/rem";

const SIZE = { sm: { box: 24, icon: 14 }, md: { box: 28, icon: 16 }, lg: { box: 32, icon: 18 } };

/**
 * A lucide icon in a solid coloured rounded square — the colour cue beside a
 * metric's label or a section's title. Solid fill (the tone's main)
 * with its contrast colour for the glyph — never a translucent tint. Decorative: the label next to it says what it is.
 *
 * tone: primary | success | warning | error | info | violet | accent
 */
export default function IconBadge({ icon: Icon, tone = "primary", size = "md", "data-testid": testId }) {
  const p = useTheme().tokens;
  const t = p[tone] ?? p.primary;
  const s = SIZE[size] ?? SIZE.md;
  return (
    <span
      aria-hidden
      data-testid={testId}
      data-tone={tone}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        width: rem(s.box),
        height: rem(s.box),
        borderRadius: rem(8),
        background: t.main,
        color: t.contrastText,
      }}
    >
      <Icon size={rem(s.icon)} strokeWidth={2} />
    </span>
  );
}
