import { StyleSheet, View } from "react-native";
import { Construction } from "lucide-react-native";
import type { StackScreenProps } from "@react-navigation/stack";

import type { RootStackParamList } from "../../navigation/RootNavigator";
import { colors, radius, spacing } from "../../theme";
import { Screen, ScreenHeader, Text } from "../../ui";

type Props = StackScreenProps<RootStackParamList, "ComingSoon">;

/**
 * Placeholder for a module the hub already lists but that is not built yet.
 *
 * Listing it early is deliberate: it shows where the app is going, and it lets
 * the navigation be shaped now — while the module is cheap to move — rather
 * than after two more are bolted on.
 */
export default function ComingSoonScreen({ route, navigation }: Props) {
  const { title, blurb } = route.params;

  return (
    <Screen>
      <ScreenHeader title={title} onBack={navigation.goBack} />
      <View style={styles.body}>
        <View style={styles.glyph}>
          <Construction size={30} color={colors.primary} />
        </View>
        <Text variant="h2" align="center">
          {title} is on the way
        </Text>
        <Text variant="secondary" align="center">
          {blurb}
        </Text>
        <Text variant="caption" color="textMuted" align="center">
          Available on the web today.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[3],
    padding: spacing[8],
  },
  glyph: {
    width: 72,
    height: 72,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceSunken,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing[2],
  },
});
