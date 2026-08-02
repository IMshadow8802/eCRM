import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { MaterialIcons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { StackNavigationProp } from "@react-navigation/stack";

import { fetchWorkspaces } from "../../api/workspaceQueries";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import useAuthStore from "../../stores/useAuthStore";
import { canSeeAny, visibleRoutes } from "../../utils/menuAccess";
import {
  colors,
  radius,
  shadows,
  spacing,
  TAB_BAR_CLEARANCE,
} from "../../theme";
import { EmptyState, Screen, Text } from "../../ui";

type Nav = StackNavigationProp<RootStackParamList>;

interface HubEntry {
  key: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  tint: keyof typeof colors;
  label: string;
  detail: string;
  /** Any one of these menu routes grants access to the row. */
  routes: string[];
  ready: boolean;
  go: (nav: Nav) => void;
}

interface HubSection {
  title: string;
  entries: HubEntry[];
}

/**
 * The hub replaces both a drawer and a per-module tab.
 *
 * An admin can reach roughly eight mobile destinations, which is too many for a
 * tab bar and nowhere near enough to justify a slide-out drawer. A hub screen
 * has a drawer's capacity but sits under the thumb rather than behind a
 * top-left handle, can carry live counts, and is a normal screen — so it can
 * gain search or recents later.
 *
 * Rows are filtered by menu rights, so a Task Collaborator sees one row and an
 * admin sees all of them, with no separate layout for either.
 */
export default function WorkHubScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const permissions = useAuthStore((s) => s.permissions);

  const routes = useMemo(() => visibleRoutes(permissions), [permissions]);

  const { data: workspaces } = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => fetchWorkspaces({ PageSize: 100 }),
  });

  const boardCount = (workspaces ?? []).filter(
    (w) => w.MyInviteStatus !== "pending" && !w.IsArchived,
  ).length;

  const sections: HubSection[] = [
    {
      title: "Workspaces",
      entries: [
        {
          key: "boards",
          icon: "dashboard",
          tint: "primary",
          label: "Boards",
          detail: boardCount
            ? `${boardCount} board${boardCount === 1 ? "" : "s"}`
            : "Your task workspaces",
          routes: ["/tasks"],
          ready: true,
          go: (nav) => nav.navigate("Boards"),
        },
      ],
    },
    {
      title: "Support",
      entries: [
        {
          key: "complaints",
          icon: "support-agent",
          tint: "danger",
          label: "Complaints",
          detail: "Log and track customer issues",
          routes: ["/support", "/support/tickets", "/support/board"],
          ready: false,
          go: (nav) =>
            nav.navigate("ComingSoon", {
              title: "Complaints",
              blurb:
                "Log a complaint from the field, track it to resolution and see everything assigned to you.",
            }),
        },
      ],
    },
    {
      title: "Sales",
      entries: [
        {
          key: "leads",
          icon: "trending-up",
          tint: "success",
          label: "Leads",
          detail: "Pipeline, calls and follow-ups",
          routes: ["/sales", "/sales/leads", "/sales/pipeline"],
          ready: false,
          go: (nav) =>
            nav.navigate("ComingSoon", {
              title: "Leads",
              blurb:
                "Your leads, log a call the moment it ends, and follow-ups due today.",
            }),
        },
      ],
    },
  ];

  const visible = sections
    .map((section) => ({
      ...section,
      entries: section.entries.filter((e) => canSeeAny(routes, e.routes)),
    }))
    .filter((section) => section.entries.length > 0);

  return (
    <Screen>
      <View style={[styles.header, { paddingTop: insets.top + spacing[3] }]}>
        <Text variant="h1">Work</Text>
        <Text variant="secondary">Everything you have access to</Text>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          !visible.length && styles.contentEmpty,
        ]}
        showsVerticalScrollIndicator={false}
      >
        {visible.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text variant="overline" color="textMuted">
              {section.title}
            </Text>

            <View style={styles.card}>
              {section.entries.map((entry, i) => (
                <Pressable
                  key={entry.key}
                  onPress={() => entry.go(navigation)}
                  style={({ pressed }) => [
                    styles.row,
                    i < section.entries.length - 1 && styles.rowDivider,
                    pressed && styles.rowPressed,
                  ]}
                >
                  <View
                    style={[styles.glyph, { backgroundColor: colors[entry.tint] }]}
                  >
                    <MaterialIcons
                      name={entry.icon}
                      size={20}
                      color={colors.textOnBrand}
                    />
                  </View>

                  <View style={styles.rowText}>
                    <View style={styles.labelRow}>
                      <Text variant="h3">{entry.label}</Text>
                      {!entry.ready ? (
                        <View style={styles.soon}>
                          <Text variant="caption" color="textSecondary">
                            Coming soon
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    <Text variant="caption" color="textMuted" numberOfLines={1}>
                      {entry.detail}
                    </Text>
                  </View>

                  <MaterialIcons
                    name="chevron-right"
                    size={22}
                    color={colors.textMuted}
                  />
                </Pressable>
              ))}
            </View>
          </View>
        ))}

        {!visible.length ? (
          <EmptyState
            icon="lock"
            title="Nothing here yet"
            message="You do not have access to any modules. Ask an administrator to grant you one."
          />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing[5],
    paddingBottom: spacing[3],
    gap: spacing[1],
    backgroundColor: colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  content: {
    padding: spacing[5],
    gap: spacing[5],
    paddingBottom: TAB_BAR_CLEARANCE,
  },
  contentEmpty: { flexGrow: 1 },
  section: { gap: spacing[2] },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    ...shadows.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    padding: spacing[4],
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  rowPressed: { backgroundColor: colors.surfacePressed },
  glyph: {
    width: 42,
    height: 42,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: { flex: 1, gap: spacing[1] },
  labelRow: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  soon: {
    paddingHorizontal: spacing[2],
    paddingVertical: 1,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceSunken,
  },
});
