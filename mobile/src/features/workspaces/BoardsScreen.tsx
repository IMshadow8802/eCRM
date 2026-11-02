import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Plus, UserPlus } from "lucide-react-native";
import type { StackScreenProps } from "@react-navigation/stack";

import { apiErrorMessage } from "../../api/errors";
import { fetchTasks } from "../../api/taskQueries";
import { fetchUserDirectory } from "../../api/userQueries";
import { fetchWorkspaceMembers, fetchWorkspaces, respondInvite } from "../../api/workspaceQueries";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import { spacing, workspaceBadge } from "../../theme";
import type { Workspace } from "../../types/api";
import {
  AvatarStack, Band, BandSheet, Button, Chip, EmptyState, ErrorCard, Footnote, GroupHeader, HeaderButton, ListGroup,
  ListRow, Screen, SkeletonRows, Text, useToast,
} from "../../ui";

type Props = StackScreenProps<RootStackParamList, "Boards">;

const TYPE_LABEL = { personal: "Personal", shared: "Shared", project: "Project" } as const;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Workspaces (E 06), reached from More. Rows: kind badge + pill, members (G5),
 * open-task count (G4); invitations answer in place (Accept, and Decline as a
 * visible text button, §7.5). The search filters the loaded list.
 */
export default function BoardsScreen({ navigation }: Props) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [term, setTerm] = useState("");

  const { data, isLoading, isRefetching, refetch, isError } = useQuery({
    // Archived boards come back only when asked for; without them they could never be restored.
    queryKey: ["workspaces", true],
    queryFn: () => fetchWorkspaces({ PageSize: 100, IncludeArchived: true }),
  });
  // G4: My Work's all-workspaces open list, counted per board.
  const open = useQuery({
    queryKey: ["tasks", "all-workspaces", "open"],
    queryFn: () => fetchTasks({ WorkspaceId: null, OnlyOpen: true, PageSize: 200 }),
  });
  const directory = useQuery({ queryKey: ["users", "directory"], queryFn: () => fetchUserDirectory() });

  const invite = useMutation({
    mutationFn: respondInvite,
    onError: (err) => toast.error(apiErrorMessage(err, "Could not answer that invite.")),
    // Accepting changes which tasks the user can see, so both lists go stale.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const q = term.trim().toLowerCase();
  const workspaces = useMemo(() => (data ?? []).filter((w) => !q || w.Name.toLowerCase().includes(q)), [data, q]);
  const pending = workspaces.filter((w) => w.MyInviteStatus === "pending");
  const listed = workspaces.filter((w) => w.MyInviteStatus !== "pending");
  const live = listed.filter((w) => !w.IsArchived);
  // No role and no invite = visible only through the admin bypass.
  const joined = live.filter((w) => w.MyRole != null || w.MyInviteStatus != null);
  const adminView = live.filter((w) => w.MyRole == null && w.MyInviteStatus == null);
  const archived = listed.filter((w) => w.IsArchived);

  // G5: members of each shared/project row, each its own cached request (the
  // key WorkspaceSettings reads).
  const team = joined.filter((w) => w.Type !== "personal");
  const members = useQueries({
    queries: team.map((w) => ({
      queryKey: ["workspace", w.Id, "members"],
      queryFn: () => fetchWorkspaceMembers({ WorkspaceId: w.Id }),
    })),
  });
  const membersOf = new Map(team.map((w, i) => [w.Id, members[i]?.data]));

  const openCount = useMemo(() => {
    const counts = new Map<number, number>();
    for (const t of open.data?.data?.tasks ?? []) {
      if (t.WorkspaceId != null) counts.set(t.WorkspaceId, (counts.get(t.WorkspaceId) ?? 0) + 1);
    }
    return counts;
  }, [open.data]);
  const ownerName = (w: Workspace) => directory.data?.find((u) => u.Id === w.OwnerUserId)?.FullName;

  // An archived board opens its settings — that is where Restore and Delete live.
  const openWorkspace = (w: Workspace) =>
    w.IsArchived
      ? navigation.navigate("WorkspaceSettings", { workspaceId: w.Id })
      : navigation.navigate("Board", { workspaceId: w.Id, name: w.Name });

  const metaOf = (w: Workspace) => {
    // G4: past one full 200-row page a count would be short, so "—" (like G3/G12).
    const full = (open.data?.data?.pagination.totalRecords ?? 0) > 200;
    const tasks = open.data ? `${full ? "—" : (openCount.get(w.Id) ?? 0)} open` : null;
    if (w.Type === "personal") return ["Only you", tasks].filter(Boolean).join(" · ");
    if (w.Type === "project") return ["Team from project", tasks].filter(Boolean).join(" · ");
    return [w.MemberCount != null ? plural(w.MemberCount, "member") : null, tasks, w.MyRole].filter(Boolean).join(" · ");
  };

  const row = (w: Workspace, i: number) => {
    const b = workspaceBadge(w.Type);
    const people = (membersOf.get(w.Id) ?? [])
      .filter((m) => m.InviteStatus === "active")
      .map((m) => ({ name: m.FullName, uri: m.Avatar, userId: m.UserId }));
    return (
      <ListRow
        key={w.Id}
        noSeparator={i === 0}
        badge={{ tone: b.tone, icon: b.icon }}
        title={w.Name}
        accessibilityLabel={w.Name}
        line3={
          <>
            <Chip label={TYPE_LABEL[w.Type]} tone={b.chip} />
            <Text variant="meta" numberOfLines={1} style={styles.flex}>{metaOf(w)}</Text>
          </>
        }
        trailing={people.length ? <AvatarStack people={people} size={24} /> : undefined}
        chevron
        onPress={() => openWorkspace(w)}
      />
    );
  };

  const group = (label: string, list: Workspace[], first = false) =>
    list.length ? (
      <View key={label}>
        <GroupHeader label={label} first={first} />
        <ListGroup>{list.map(row)}</ListGroup>
      </View>
    ) : null;

  let body;
  if (isLoading) body = <SkeletonRows rows={3} />;
  else if (isError) body = <ErrorCard onRetry={() => void refetch()} />;
  else if (!workspaces.length) {
    body = q ? (
      <EmptyState module="tasks" title="No matches" message={`No workspace is called "${term.trim()}".`} />
    ) : (
      <EmptyState
        module="tasks"
        title="No boards yet"
        message="Boards you own or are invited to appear here."
        actionLabel="Create a board"
        onAction={() => navigation.navigate("WorkspaceForm", {})}
      />
    );
  } else {
    body = (
      <>
        {group(plural(joined.length, "workspace"), joined, true)}
        {pending.length ? (
          <View>
            <GroupHeader label={`Invitations · ${pending.length}`} first={!joined.length} />
            <ListGroup>
              {pending.map((w, i) => {
                const from = ownerName(w);
                return (
                  <ListRow
                    key={w.Id}
                    noSeparator={i === 0}
                    badge={{ tone: "teal", icon: UserPlus }}
                    title={w.Name}
                    meta={`${TYPE_LABEL[w.Type]}${from ? ` · from ${from}` : ""}`}
                    trailing={
                      <View style={styles.answer}>
                        <Button
                          title="Decline"
                          variant="ghost"
                          size="xs"
                          disabled={invite.isPending}
                          onPress={() => invite.mutate({ WorkspaceId: w.Id, Action: "decline" })}
                          accessibilityLabel={`Decline ${w.Name}`}
                        />
                        <Button
                          title="Accept"
                          size="xs"
                          disabled={invite.isPending}
                          onPress={() => invite.mutate({ WorkspaceId: w.Id, Action: "accept" })}
                          accessibilityLabel={`Accept ${w.Name}`}
                        />
                      </View>
                    }
                  />
                );
              })}
            </ListGroup>
          </View>
        ) : null}
        {group("Admin view (read-only)", adminView)}
        {group("Archived", archived)}
        <Footnote icon={Lock}>Personal workspaces are private, even from admins. Shared ones need the invite accepted.</Footnote>
      </>
    );
  }

  return (
    <Screen band>
      <Band
        title="Workspaces"
        variant="record"
        onBack={navigation.goBack}
        actions={<HeaderButton label="New" icon={Plus} accessibilityLabel="New workspace" onPress={() => navigation.navigate("WorkspaceForm", {})} />}
        search={{ placeholder: "Search workspaces", value: term, onChangeText: setTerm }}
      />
      <BandSheet scroll refresh={{ refreshing: isRefetching && !isLoading, onRefresh: () => void refetch() }}>
        {body}
      </BandSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  answer: { flexDirection: "row", alignItems: "center", gap: spacing[1] },
});
