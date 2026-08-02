import { Image, StyleSheet, View } from "react-native";

import { colors, radius } from "../theme";
import { Text } from "./Text";

export interface AvatarProps {
  name?: string | null;
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

/** Falls back to initials when there is no avatar image — most users have none. */
export function Avatar({ name, uri, size = 32 }: AvatarProps) {
  const box = { width: size, height: size, borderRadius: radius.full };

  if (uri) {
    return <Image source={{ uri }} style={[styles.image, box]} />;
  }

  return (
    <View style={[styles.fallback, box]}>
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
  fallback: {
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
});

export default Avatar;
