import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronRight,
  Headset,
  LayoutDashboard,
  Lock,
  TrendingUp,
  type LucideIcon,
} from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { StackNavigationProp } from "@react-navigation/stack";

import { fetchPipelines } from "../../api/configQueries";
import { fetchTickets } from "../../api/ticketQueries";
import { fetchWorkspaces } from "../../api/workspaceQueries";
import { lifecycleOf, stageRoles } from "../support/ticketHelpers";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import useAuthStore from "../../stores/useAuthStore";
import { canSeeAny, visibleRoutes } from "../../utils/menuAccess";
import {
  colors,
  radius,
  spacing,
  SCREEN_PADDING,
  TAB_BAR_CLEARANCE,
} from "../../theme";
import { Card, Chip, EmptyState, Screen, Text } from "../../ui";

type Nav = StackNavigationProp<RootStackParamList>;

interface HubEntry {
  key: string;
  Icon: LucideIcon;
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
    queryKey: ["workspaces", false],
    queryFn: () => fetchWorkspaces({ PageSize: 100 }),
  });

  // Both counts share their query keys with the screens they lead to, so the
  // hub warms the cache rather than paying for a second fetch.
  //
  // PageSize must match ComplaintsScreen's exactly. It did not — the hub asked
  // for 100 and the screen for 200 under the same key, so whichever mounted
  // first won: opening the hub before Complaints silently capped that list at
  // 100 rows. Sharing a key means sharing the parameters too.
  const { data: tickets } = useQuery({
    queryKey: ["tickets", ""],
    queryFn: () => fetchTickets({ PageSize: 200, SearchTerm: null }),
  });
  const { data: pipeline } = useQuery({
    queryKey: ["pipelines", "ticket"],
    queryFn: () => fetchPipelines({ Entity: "ticket" }),
  });

  const boardCount = (workspaces ?? []).filter(
    (w) => w.MyInviteStatus !== "pending" && !w.IsArchived,
  ).length;

  // Deliberately NOT scoped to one pipeline: this is a count across every
  // support pipeline, and scoping would silently drop tickets outside the
  // default one. Only StageType is read here, which is per-stage anyway.
  const roles = useMemo(() => stageRoles(pipeline?.stages), [pipeline]);
  const openComplaints = useMemo(
    () =>
      (tickets?.data?.tickets ?? []).filter(
        (t) => lifecycleOf(t, roles) === "open",
      ).length,
    [tickets, roles],
  );

  const sections: HubSection[] = [
    {
      title: "Workspaces",
      entries: [
        {
          key: "boards",
          Icon: LayoutDashboard,
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
          Icon: Headset,
          tint: "danger",
          label: "Complaints",
          detail: openComplaints
            ? `${openComplaints} open`
            : "Log and track customer issues",
          routes: ["/support", "/support/tickets", "/support/board"],
          ready: true,
          go: (nav) => nav.navigate("Complaints"),
        },
      ],
    },
    {
      title: "Sales",
      entries: [
        {
          key: "leads",
          Icon: TrendingUp,
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

            <Card padded={false} gap={0}>
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
                    <entry.Icon size={20} color={colors.textOnBrand} />
                  </View>

                  <View style={styles.rowText}>
                    <View style={styles.labelRow}>
                      <Text variant="h3">{entry.label}</Text>
                      {!entry.ready ? <Chip label="Coming soon" /> : null}
                    </View>
                    <Text variant="caption" color="textMuted" numberOfLines={1}>
                      {entry.detail}
                    </Text>
                  </View>

                  <ChevronRight
                    size={22}
                    color={colors.textMuted}
                  />
                </Pressable>
              ))}
            </Card>
          </View>
        ))}

        {!visible.length ? (
          <EmptyState
            icon={Lock}
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
    paddingHorizontal: SCREEN_PADDING,
    paddingBottom: spacing[3],
    gap: spacing[1],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  content: {
    padding: SCREEN_PADDING,
    gap: spacing[5],
    paddingBottom: TAB_BAR_CLEARANCE,
  },
  contentEmpty: { flexGrow: 1 },
  section: { gap: spacing[2] },
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
});
