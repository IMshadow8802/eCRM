// Avatar presets — a user picks a bundled icon + color, an emoji, or a color
// for their initials. Stored as one compact string in tblUser.Avatar:
//   "icon:rocket|violet"   an icon on a color
//   "emoji:🚀"             an emoji
//   "color:violet"         colored initials
//   "" / null              default gradient initials
//
// No new dependency — icons come from lucide-react (already used everywhere).
import {
  Rocket, Cat, Dog, Star, Heart, Flame, Zap, Crown, Ghost, Bot,
  Bird, Fish, Leaf, Flower2, Sun, Moon, Cloud, Coffee, Camera, Music,
  Gamepad2, Anchor, Diamond, Bug,
} from "lucide-react";

export const AVATAR_COLORS = {
  violet: "#7C3AED",
  blue: "#2563EB",
  cyan: "#0891B2",
  green: "#059669",
  amber: "#D97706",
  red: "#DC2626",
  pink: "#DB2777",
  slate: "#475569",
};

export const AVATAR_ICONS = {
  rocket: Rocket, cat: Cat, dog: Dog, star: Star, heart: Heart, flame: Flame,
  zap: Zap, crown: Crown, ghost: Ghost, bot: Bot, bird: Bird, fish: Fish,
  leaf: Leaf, flower: Flower2, sun: Sun, moon: Moon, cloud: Cloud,
  coffee: Coffee, camera: Camera, music: Music, game: Gamepad2, anchor: Anchor,
  diamond: Diamond, bug: Bug,
};

// A small, safe emoji set for the picker.
export const AVATAR_EMOJIS = [
  "🙂", "😎", "🚀", "🐱", "🐶", "⭐", "🔥", "💎", "🌸", "🎧",
  "☕", "🦊", "🐼", "🦁", "🌙", "⚡", "🎯", "🍀",
];

export const AVATAR_COLOR_KEYS = Object.keys(AVATAR_COLORS);
export const AVATAR_ICON_KEYS = Object.keys(AVATAR_ICONS);

export const colorOf = (key) => AVATAR_COLORS[key] || AVATAR_COLORS.violet;

// Parse a stored preset string into a render descriptor (or null for default).
export function parseAvatar(preset) {
  if (!preset || typeof preset !== "string") return null;
  const idx = preset.indexOf(":");
  if (idx === -1) return null;
  const kind = preset.slice(0, idx);
  const rest = preset.slice(idx + 1);

  if (kind === "emoji") return rest ? { kind: "emoji", emoji: rest } : null;

  if (kind === "icon") {
    const [iconKey, colorKey] = rest.split("|");
    const Icon = AVATAR_ICONS[iconKey];
    if (!Icon) return null;
    return { kind: "icon", Icon, iconKey, colorKey, color: colorOf(colorKey) };
  }

  if (kind === "color") {
    return { kind: "color", colorKey: rest, color: colorOf(rest) };
  }

  return null;
}

// Build a preset string from picker selections.
export function makeAvatar(kind, value, colorKey) {
  if (kind === "emoji") return `emoji:${value}`;
  if (kind === "icon") return `icon:${value}|${colorKey || "violet"}`;
  if (kind === "color") return `color:${value}`;
  return "";
}
