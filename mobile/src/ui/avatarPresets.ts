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
// Mirrors web/src/utils/avatarPresets.js EXACTLY — same colour keys, same icon
// keys, and now the same icon set, since both clients are on lucide. The stored
// string renders identically on web and mobile with no translation layer.
import {
  Anchor, Bird, Bot, Bug, Camera, Cat, Cloud, Coffee, Crown, Diamond, Dog,
  Fish, Flame, Flower2, Gamepad2, Ghost, Heart, Leaf, Moon, Music, Rocket,
  Star, Sun, Zap,
  type LucideIcon,
} from "lucide-react-native";

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

export const AVATAR_ICONS: Record<string, LucideIcon> = {
  rocket: Rocket, cat: Cat, dog: Dog, star: Star, heart: Heart, flame: Flame,
  zap: Zap, crown: Crown, ghost: Ghost, bot: Bot, bird: Bird, fish: Fish,
  leaf: Leaf, flower: Flower2, sun: Sun, moon: Moon, cloud: Cloud,
  coffee: Coffee, camera: Camera, music: Music, game: Gamepad2, anchor: Anchor,
  diamond: Diamond, bug: Bug,
};

export const colorOf = (key?: string): string =>
  (key && AVATAR_COLORS[key]) || AVATAR_COLORS.violet!;

export type ParsedAvatar =
  | { kind: "icon"; Icon: LucideIcon; color: string }
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
    const Icon = iconKey ? AVATAR_ICONS[iconKey] : undefined;
    if (!Icon) return null;
    return { kind: "icon", Icon, color: colorOf(colorKey) };
  }

  if (kind === "color") return { kind: "color", color: colorOf(rest) };

  return null;
}
