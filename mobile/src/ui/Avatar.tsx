import { Image, StyleSheet, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, radius } from "../theme";
import { Text } from "./Text";
import { parseAvatar } from "./avatarPresets";

export interface AvatarProps {
  name?: string | null;
  /**
   * The stored tblUser.Avatar value — a preset string like "icon:ghost|violet",
   * "emoji:🚀" or "color:violet", NOT a URL. Real URLs are handled too.
   */
  uri?: string | null;
  size?: number;
}

const initialsOf = (name?: string | null) =>
  (name ?? "?")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";

/**
 * Renders whichever avatar style the user picked on the web, falling back to
 * initials whenever the value is empty or unrecognised — an unknown preset must
 * never render a broken image or take out the row it sits in.
 */
export function Avatar({ name, uri, size = 32 }: AvatarProps) {
  const box = { width: size, height: size, borderRadius: radius.full };
  const preset = parseAvatar(uri);

  if (preset?.kind === "image") {
    return <Image source={{ uri: preset.uri }} style={[styles.image, box]} />;
  }

  if (preset?.kind === "icon") {
    return (
      <View style={[styles.center, box, { backgroundColor: preset.color }]}>
        <MaterialCommunityIcons
          name={preset.icon}
          size={Math.round(size * 0.55)}
          color={colors.textOnBrand}
        />
      </View>
    );
  }

  if (preset?.kind === "emoji") {
    return (
      <View style={[styles.center, box, styles.emojiBox]}>
        <Text style={{ fontSize: Math.round(size * 0.5) }}>{preset.emoji}</Text>
      </View>
    );
  }

  const background = preset?.kind === "color" ? preset.color : colors.primary;

  return (
    <View style={[styles.center, box, { backgroundColor: background }]}>
      <Text
        variant="caption"
        color="textOnBrand"
        style={{ fontSize: Math.round(size * 0.36) }}
      >
        {initialsOf(name)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  image: { backgroundColor: colors.surfaceSunken },
  center: { alignItems: "center", justifyContent: "center" },
  emojiBox: { backgroundColor: colors.surfaceSunken },
});

export default Avatar;
