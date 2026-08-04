import { useCallback, useMemo } from "react";
import { SectionList, StyleSheet, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CloudOff, LayoutDashboard, Mail, Plus } from "lucide-react-native";

import type { StackScreenProps } from "@react-navigation/stack";

import { fetchWorkspaces, respondInvite } from "../../api/workspaceQueries";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import type { Workspace } from "../../types/api";
import { colors, radius, spacing, SCREEN_PADDING } from "../../theme";
import {
  Button,
  Card,
  EmptyState,
  Fab,
  Refresher,
  Screen,
  ScreenHeader,
  Text,
} from "../../ui";
import { WorkspaceCard } from "./WorkspaceCard";

type Props = StackScreenProps<RootStackParamList, "Boards">;

export default function BoardsScreen({ navigation }: Props) {
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

  const openWorkspace = useCallback(
    (workspace: Workspace) =>
      navigation.navigate("Board", {
        workspaceId: workspace.Id,
        name: workspace.Name,
      }),
    [navigation],
  );

  const activeCount = workspaces.filter(
    (w) => w.MyInviteStatus !== "pending" && !w.IsArchived,
  ).length;

  return (
    <Screen>
      <ScreenHeader
        title="Boards"
        subtitle={
          pending.length
            ? `${activeCount} board${activeCount === 1 ? "" : "s"} · ${pending.length} invite${pending.length === 1 ? "" : "s"}`
            : `${activeCount} board${activeCount === 1 ? "" : "s"}`
        }
        onBack={navigation.goBack}
      />

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
          <Refresher refreshing={isRefetching && !isLoading} onRefresh={refetch} />
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
                <Card key={w.Id} style={styles.inviteCard}>
                  <View style={styles.inviteTop}>
                    <View style={styles.inviteGlyph}>
                      <Mail
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
                </Card>
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
              icon={isError ? CloudOff : LayoutDashboard}
              title={isError ? "Couldn't load your boards" : "No boards yet"}
              message={
                isError
                  ? "Pull down to try again."
                  : "Boards you own or are invited to appear here."
              }
              actionLabel={isError ? undefined : "Create a board"}
              onAction={
                isError ? undefined : () => navigation.navigate("WorkspaceForm", {})
              }
            />
          )
        }
      />

      <Fab
        icon={Plus}
        accessibilityLabel="Create a board"
        onPress={() => navigation.navigate("WorkspaceForm", {})}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  // No top padding — the section header below provides the gap. Stacking
  // header padding, list padding and section padding gave 44px of dead space.
  // Pushed screen, not a tab — no floating bar to clear, but the FAB still
  // needs room or it covers the last card.
  content: { paddingBottom: spacing[20] },
  contentEmpty: { flexGrow: 1 },
  sectionTitle: {
    paddingHorizontal: SCREEN_PADDING,
    paddingTop: spacing[3],
    paddingBottom: spacing[2],
  },
  // 16, matching the board columns: the gap has to out-reach the card shadow
  // or stacked shadows meet and the list reads as one grey slab.
  cardWrap: { paddingHorizontal: SCREEN_PADDING, paddingBottom: spacing[5] },
  // The one card in the app that keeps an outline. An invite is a decision
  // waiting on you rather than somewhere you can already go, and the accent
  // ring is what says so — Card supplies everything else.
  inviteCard: {
    marginHorizontal: SCREEN_PADDING,
    marginBottom: spacing[3],
    borderWidth: 1,
    borderColor: colors.accent,
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
