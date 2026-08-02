import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";

import { colors, radius, spacing, HIT_TARGET } from "../theme";
import { Text } from "./Text";

export interface PageHeaderAction {
  icon: keyof typeof MaterialIcons.glyphMap;
  onPress: () => void;
  label: string;
  /** Small dot on the icon — unread counts, pending invites. */
  badge?: boolean;
}

export interface PageHeaderProps {
  title: string;
  /** Small line above the title — a greeting, a workspace name, a date. */
  eyebrow?: string;
  subtitle?: string;
  actions?: PageHeaderAction[];
  /** Search field, filter chips — sits below the title, above the content. */
  children?: ReactNode;
}

/**
 * The page title, rendered as part of the page rather than in a navigation bar.
 *
 * React Navigation's header is switched off app-wide (see RootNavigator): a
 * fixed 56px chrome bar with a small centred title is the single biggest thing
 * that makes an app look dated, and it costs a tenth of the screen on a phone.
 * Here the title is large, left-aligned, scrolls away with the content, and any
 * actions sit inline next to it.
 */
export function PageHeader({
  title,
  eyebrow,
  subtitle,
  actions,
  children,
}: PageHeaderProps) {
  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <View style={styles.titleBlock}>
          {eyebrow ? (
            <Text variant="overline" color="textMuted">
              {eyebrow}
            </Text>
          ) : null}
          <Text variant="h1">{title}</Text>
          {subtitle ? <Text variant="secondary">{subtitle}</Text> : null}
        </View>

        {actions?.length ? (
          <View style={styles.actions}>
            {actions.map((action) => (
              <Pressable
                key={action.label}
                onPress={action.onPress}
                accessibilityLabel={action.label}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.action,
                  pressed && styles.actionPressed,
                ]}
              >
                <MaterialIcons
                  name={action.icon}
                  size={20}
                  color={colors.text}
                />
                {action.badge ? <View style={styles.badge} /> : null}
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing[5],
    paddingBottom: spacing[4],
    gap: spacing[4],
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing[3],
  },
  titleBlock: { flex: 1, gap: spacing[1] },
  actions: { flexDirection: "row", gap: spacing[2] },
  action: {
    width: HIT_TARGET,
    height: HIT_TARGET,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  actionPressed: { opacity: 0.6 },
  badge: {
    position: "absolute",
    top: spacing[2],
    right: spacing[2],
    width: spacing[2],
    height: spacing[2],
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
});

export default PageHeader;
