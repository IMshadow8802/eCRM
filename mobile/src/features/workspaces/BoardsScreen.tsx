import { useCallback, useMemo } from "react";
import { RefreshControl, SectionList, StyleSheet, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MaterialIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fetchWorkspaces, respondInvite } from "../../api/workspaceQueries";
import type { Workspace } from "../../types/api";
import { colors, radius, shadows, spacing } from "../../theme";
import { Button, EmptyState, Screen, Text } from "../../ui";
import { WorkspaceCard } from "./WorkspaceCard";

export default function BoardsScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const { data, isLoading, isRefetching, refetch, isError } = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => fetchWorkspaces({ PageSize: 100 }),
  });

  const invite = useMutation({
    mutationFn: respondInvite,
    // Accepting changes which tasks the user can see, so both lists go stale.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const workspaces = useMemo(() => data ?? [], [data]);

  // A pending invite is not a board you are in yet — it is a decision waiting
  // on you, so it gets its own block rather than sitting in the list looking
  // like somewhere you can already open.
  const pending = useMemo(
    () => workspaces.filter((w) => w.MyInviteStatus === "pending"),
    [workspaces],
  );

  const sections = useMemo(() => {
    const joined = workspaces.filter(
      (w) => w.MyInviteStatus !== "pending" && !w.IsArchived,
    );
    const archived = workspaces.filter(
      (w) => w.MyInviteStatus !== "pending" && w.IsArchived,
    );
    const out: { title: string; data: Workspace[] }[] = [];
    if (joined.length) out.push({ title: "Your boards", data: joined });
    if (archived.length) out.push({ title: "Archived", data: archived });
    return out;
  }, [workspaces]);

  const openWorkspace = useCallback((workspace: Workspace) => {
    // Phase 2 continues: push the board for this workspace.
    void workspace;
  }, []);

  const activeCount = workspaces.filter(
    (w) => w.MyInviteStatus !== "pending" && !w.IsArchived,
  ).length;

  return (
    <Screen>
      <View style={[styles.header, { paddingTop: insets.top + spacing[3] }]}>
        <Text variant="h1">Boards</Text>
        <View style={styles.headerStats}>
          <View style={styles.stat}>
            <MaterialIcons name="dashboard" size={14} color={colors.primary} />
            <Text variant="secondary">
              {activeCount} board{activeCount === 1 ? "" : "s"}
            </Text>
          </View>
          {pending.length ? (
            <View style={styles.stat}>
              <MaterialIcons
                name="mark-email-unread"
                size={14}
                color={colors.accent}
              />
              <Text variant="secondary" color="accent">
                {pending.length} invite{pending.length === 1 ? "" : "s"}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => String(item.Id)}
        contentContainerStyle={[
          styles.content,
          !sections.length && !pending.length && styles.contentEmpty,
        ]}
        stickySectionHeadersEnabled={false}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching && !isLoading}
            onRefresh={refetch}
            tintColor={colors.primary}
          />
        }
        ListHeaderComponent={
          pending.length ? (
            <View>
              <Text
                variant="overline"
                color="textMuted"
                style={styles.sectionTitle}
              >
                Invitations
              </Text>
              {pending.map((w) => (
                <View key={w.Id} style={styles.inviteCard}>
                  <View style={styles.inviteTop}>
                    <View style={styles.inviteGlyph}>
                      <MaterialIcons
                        name="mail"
                        size={20}
                        color={colors.textOnBrand}
                      />
                    </View>
                    <View style={styles.inviteText}>
                      <Text variant="h3" numberOfLines={1}>
                        {w.Name}
                      </Text>
                      <Text variant="caption" color="textMuted">
                        Invited as {w.MyRole ?? "member"}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.inviteActions}>
                    <Button
                      title="Decline"
                      variant="secondary"
                      size="sm"
                      style={styles.inviteButton}
                      disabled={invite.isPending}
                      onPress={() =>
                        invite.mutate({ WorkspaceId: w.Id, Action: "decline" })
                      }
                    />
                    <Button
                      title="Accept"
                      size="sm"
                      style={styles.inviteButton}
                      disabled={invite.isPending}
                      onPress={() =>
                        invite.mutate({ WorkspaceId: w.Id, Action: "accept" })
                      }
                    />
                  </View>
                </View>
              ))}
            </View>
          ) : null
        }
        renderSectionHeader={({ section }) => (
          <Text variant="overline" color="textMuted" style={styles.sectionTitle}>
            {section.title}
          </Text>
        )}
        renderItem={({ item }) => (
          <View style={styles.cardWrap}>
            <WorkspaceCard workspace={item} onPress={openWorkspace} />
          </View>
        )}
        ListEmptyComponent={
          isLoading || pending.length ? null : (
            <EmptyState
              icon={isError ? "cloud-off" : "dashboard-customize"}
              title={isError ? "Couldn't load your boards" : "No boards yet"}
              message={
                isError
                  ? "Pull down to try again."
                  : "Boards you own or are invited to appear here. Create one on the web."
              }
            />
          )
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing[5],
    paddingBottom: spacing[4],
    gap: spacing[2],
    backgroundColor: colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  headerStats: { flexDirection: "row", alignItems: "center", gap: spacing[4] },
  stat: { flexDirection: "row", alignItems: "center", gap: spacing[1] },
  content: { paddingTop: spacing[2], paddingBottom: spacing[10] },
  contentEmpty: { flexGrow: 1 },
  sectionTitle: {
    paddingHorizontal: spacing[5],
    paddingTop: spacing[4],
    paddingBottom: spacing[2],
  },
  cardWrap: { paddingHorizontal: spacing[5], paddingBottom: spacing[3] },
  inviteCard: {
    marginHorizontal: spacing[5],
    marginBottom: spacing[3],
    padding: spacing[4],
    gap: spacing[3],
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.accent,
    ...shadows.md,
  },
  inviteTop: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  inviteGlyph: {
    width: 42,
    height: 42,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  inviteText: { flex: 1, gap: spacing[1] },
  inviteActions: { flexDirection: "row", gap: spacing[2] },
  inviteButton: { flex: 1 },
});
