// src/ui/avatarPresets.ts
//
// tblUser.Avatar does NOT hold a URL. It holds a compact preset string chosen
// in the web profile picker:
//
//   "icon:rocket|violet"   an icon on a colour
//   "emoji:🚀"             an emoji
//   "color:violet"         coloured initials
//   "" / null              default initials
//
// Feeding that to <Image source={{uri}}> fails with
// "no suitable image url loader found for icon:ghost%7cviolet".
//
// Mirrors web/src/utils/avatarPresets.js — the colour keys and icon keys MUST
// stay in step with it, since the same string renders on both clients.
// The web draws these with lucide-react; the equivalents here come from
// MaterialCommunityIcons, which covers all 24 without a new dependency.
import type { MaterialCommunityIcons } from "@expo/vector-icons";

type MCIName = keyof typeof MaterialCommunityIcons.glyphMap;

export const AVATAR_COLORS: Record<string, string> = {
  violet: "#7C3AED",
  blue: "#2563EB",
  cyan: "#0891B2",
  green: "#059669",
  amber: "#D97706",
  red: "#DC2626",
  pink: "#DB2777",
  slate: "#475569",
};

/** lucide key (as stored) -> MaterialCommunityIcons name. */
export const AVATAR_ICONS: Record<string, MCIName> = {
  rocket: "rocket",
  cat: "cat",
  dog: "dog",
  star: "star",
  heart: "heart",
  flame: "fire",
  zap: "flash",
  crown: "crown",
  ghost: "ghost",
  bot: "robot",
  bird: "bird",
  fish: "fish",
  leaf: "leaf",
  flower: "flower",
  sun: "weather-sunny",
  moon: "weather-night",
  cloud: "cloud",
  coffee: "coffee",
  camera: "camera",
  music: "music",
  game: "gamepad-variant",
  anchor: "anchor",
  diamond: "diamond-stone",
  bug: "bug",
};

export const colorOf = (key?: string): string =>
  (key && AVATAR_COLORS[key]) || AVATAR_COLORS.violet!;

export type ParsedAvatar =
  | { kind: "icon"; icon: MCIName; color: string }
  | { kind: "emoji"; emoji: string }
  | { kind: "color"; color: string }
  | { kind: "image"; uri: string }
  | null;

/**
 * Parse a stored avatar value. Returns null for anything unrecognised so the
 * caller falls back to initials — an unknown preset must never render a broken
 * image or crash the row it is in.
 */
export function parseAvatar(preset?: string | null): ParsedAvatar {
  if (!preset || typeof preset !== "string") return null;

  // Real uploaded avatars are still possible; treat them as images.
  if (/^https?:\/\//i.test(preset) || preset.startsWith("file://")) {
    return { kind: "image", uri: preset };
  }

  const idx = preset.indexOf(":");
  if (idx === -1) return null;

  const kind = preset.slice(0, idx);
  const rest = preset.slice(idx + 1);

  if (kind === "emoji") return rest ? { kind: "emoji", emoji: rest } : null;

  if (kind === "icon") {
    const [iconKey, colorKey] = rest.split("|");
    const icon = iconKey ? AVATAR_ICONS[iconKey] : undefined;
    if (!icon) return null;
    return { kind: "icon", icon, color: colorOf(colorKey) };
  }

  if (kind === "color") return { kind: "color", color: colorOf(rest) };

  return null;
}
