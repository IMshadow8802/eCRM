import { useTheme } from "@mui/material/styles";
import { parseAvatar } from "../../utils/avatarPresets";

/**
 * Avatar — text initials fallback, optional image `src`, or a `preset` string
 * (icon/emoji/color chosen by the user). Online dot + gradient ring optional.
 */
const SIZE = {
  xs: { box: 20, fz: 9 },
  sm: { box: 28, fz: 11 },
  md: { box: 36, fz: 13 },
  lg: { box: 44, fz: 15 },
  xl: { box: 64, fz: 20 },
};

function initials(name) {
  if (!name) return "?";
  const parts = String(name).trim().split(/\s+/).slice(0, 2);
  return parts.map((w) => w[0]?.toUpperCase()).join("");
}

function hashHue(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) % 360;
  }
  return h;
}

export default function Avatar({
  name,
  src,
  preset,
  size = "md",
  online,
  ring = false,
  onClick,
  "data-testid": testId,
}) {
  const theme = useTheme();
  const p = theme.tokens;
  const s = SIZE[size] ?? SIZE.md;
  const hue = hashHue(String(name || "user"));
  const av = src ? null : parseAvatar(preset);
  const presetBg =
    av?.kind === "icon" || av?.kind === "color" ? av.color : undefined;

  return (
    <span
      style={{ position: "relative", display: "inline-flex" }}
      data-testid={testId}
    >
      {ring && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: -3,
            borderRadius: theme.radii.full,
            background: p.gradient.statAccent,
          }}
        />
      )}
      <span
        role={onClick ? "button" : "img"}
        aria-label={name}
        onClick={onClick}
        tabIndex={onClick ? 0 : undefined}
        style={{
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: s.box,
          height: s.box,
          borderRadius: theme.radii.full,
          overflow: "hidden",
          background: src
            ? undefined
            : presetBg
              ? presetBg
              : `linear-gradient(135deg, hsl(${hue}, 68%, 60%), hsl(${(hue + 40) % 360}, 68%, 52%))`,
          color: "#FFFFFF",
          fontSize: av?.kind === "emoji" ? Math.round(s.box * 0.58) : s.fz,
          fontWeight: 700,
          border: `2px solid ${p.surface.card}`,
          cursor: onClick ? "pointer" : "default",
        }}
      >
        {src ? (
          <img
            src={src}
            alt={name}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : av?.kind === "emoji" ? (
          <span aria-hidden="true">{av.emoji}</span>
        ) : av?.kind === "icon" ? (
          <av.Icon size={Math.round(s.box * 0.52)} strokeWidth={2.4} />
        ) : (
          initials(name)
        )}
      </span>
      {online != null && (
        <span
          aria-label={online ? "online" : "offline"}
          style={{
            position: "absolute",
            right: -1,
            bottom: -1,
            width: Math.max(8, s.box / 4),
            height: Math.max(8, s.box / 4),
            borderRadius: theme.radii.full,
            backgroundColor: online ? p.success.main : p.text.tertiary,
            border: `2px solid ${p.surface.card}`,
          }}
        />
      )}
    </span>
  );
}
