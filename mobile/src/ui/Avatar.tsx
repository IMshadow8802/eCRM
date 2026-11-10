import { Image, StyleSheet, View } from "react-native";

import { badgeTones, colors, radius, type BadgeTone, type ColorKey } from "../theme";
import { Text } from "./Text";
import { parseAvatar } from "./avatarPresets";

export interface AvatarProps {
  name?: string | null;
  /**
   * The stored tblUser.Avatar value — a preset string like "icon:ghost|violet",
   * "emoji:🚀" or "color:violet", NOT a URL. Real URLs are handled too.
   */
  uri?: string | null;
  /** Picks the initials tone, so one person keeps one colour everywhere. Falls back to the name. */
  userId?: number | null;
  size?: number;
  /**
   * A ring in the colour of what the avatar sits on: `surface` in a stack,
   * `band` on the band. E's 28 (`.av`) has a 2 px surface ring by default;
   * pass null for none (E draws the comment and Home avatars without it).
   */
  ring?: ColorKey | null;
}

const initialsOf = (name?: string | null) =>
  (name ?? "?")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";

/** E's a1–a6, in order. */
const AVATAR_TONES: BadgeTone[] = ["indigo", "butter", "mint", "lilac", "peach", "teal"];

/** A stored `color:<name>` preset on the sorbet palette (proposed in spec §3.17). */
export const AVATAR_PRESET_TONE: Record<string, BadgeTone> = {
  violet: "lilac", blue: "indigo", cyan: "teal", green: "mint", amber: "butter", red: "red", pink: "peach", slate: "slate",
};

/** Stable per person: the id when known, else the name's character sum. */
export function avatarTone(userId?: number | null, name?: string | null): BadgeTone {
  const key = userId != null && Number.isFinite(userId)
    ? Math.abs(Math.trunc(userId))
    : [...(name ?? "")].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  return AVATAR_TONES[key % AVATAR_TONES.length]!;
}

/** Initials size per avatar size (E §3.17); anything else scales. */
const INITIALS: Record<number, number> = { 22: 9, 24: 9, 28: 11, 36: 12, 40: 14, 44: 15, 88: 30 };
const ringWidth = (size: number) => (size >= 88 ? 4 : 2);

/**
 * Initials on a sorbet tone, or whichever preset the user picked on the web.
 * Falls back to initials whenever the value is empty or unrecognised — an
 * unknown preset must never render a broken image or take out its row.
 */
export function Avatar({ name, uri, userId, size = 28, ring: ringProp }: AvatarProps) {
  const ring = ringProp === undefined ? (size === 28 ? "surface" : null) : ringProp;
  const ringStyle = ring ? { borderWidth: ringWidth(size), borderColor: colors[ring] } : null;
  const box = [{ width: size, height: size, borderRadius: radius.full }, ringStyle];
  const preset = parseAvatar(uri);

  if (preset?.kind === "image") {
    return <Image source={{ uri: preset.uri }} style={[styles.image, ...box]} />;
  }
  if (preset?.kind === "emoji") {
    return (
      <View style={[styles.center, styles.emojiBox, ...box]}>
        <Text style={{ fontSize: Math.round(size * 0.5) }}>{preset.emoji}</Text>
      </View>
    );
  }

  const tone =
    preset?.kind === "color" || preset?.kind === "icon"
      ? (AVATAR_PRESET_TONE[preset.key] ?? "lilac")
      : avatarTone(userId, name);
  const { fill, ink } = badgeTones[tone];

  if (preset?.kind === "icon") {
    return (
      <View style={[styles.center, { backgroundColor: fill }, ...box]}>
        <preset.Icon size={Math.round(size * 0.55)} color={ink} />
      </View>
    );
  }
  return (
    <View style={[styles.center, { backgroundColor: fill }, ...box]}>
      <Text
        variant="avatar"
        scaleCap="chrome"
        style={{ color: ink, fontSize: INITIALS[size] ?? Math.round(size * 0.38), lineHeight: undefined }}
      >
        {initialsOf(name)}
      </Text>
    </View>
  );
}

export interface AvatarStackProps {
  people: { name?: string | null; uri?: string | null; userId?: number | null }[];
  /** Shown before "+N". */
  max?: number;
  size?: number;
  /** The ring colour: what the stack sits on. */
  ring?: ColorKey;
}

/** Overlapping avatars, first `max` then a teal "+N" (E `.avs`). */
export function AvatarStack({ people, max = 3, size = 28, ring = "surface" }: AvatarStackProps) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  const { fill, ink } = badgeTones.teal;
  return (
    <View style={styles.stack} accessibilityLabel={`${people.length} people`}>
      {shown.map((p, i) => (
        <View key={`${p.userId ?? p.name ?? ""}-${i}`} style={i > 0 && styles.overlap}>
          <Avatar name={p.name} uri={p.uri} userId={p.userId} size={size} ring={ring} />
        </View>
      ))}
      {extra > 0 ? (
        <View
          style={[
            styles.center,
            styles.overlap,
            styles.ring2,
            { width: size, height: size, borderRadius: radius.full, backgroundColor: fill, borderColor: colors[ring] },
          ]}
        >
          <Text variant="avatar" scaleCap="chrome" style={[styles.more, { color: ink }]}>{`+${extra}`}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  image: { backgroundColor: colors.surfaceSunken },
  center: { alignItems: "center", justifyContent: "center" },
  emojiBox: { backgroundColor: colors.surfaceSunken },
  stack: { flexDirection: "row" },
  overlap: { marginLeft: -8 },
  more: { fontSize: 10 },
  ring2: { borderWidth: 2 },
});

export default Avatar;
