import { useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Users } from "lucide-react-native";
import type {
  StackNavigationProp,
  StackScreenProps,
} from "@react-navigation/stack";

import { fetchUserDirectory } from "../../api/userQueries";
import { fetchWorkspaces, saveWorkspace } from "../../api/workspaceQueries";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import type { Workspace, WorkspaceType } from "../../types/api";
import { colors, spacing, SCREEN_PADDING } from "../../theme";
import { Button, Input, Screen, ScreenHeader, Select, Text } from "../../ui";

type Props = StackScreenProps<RootStackParamList, "WorkspaceForm">;
type Nav = StackNavigationProp<RootStackParamList, "WorkspaceForm">;

/**
 * `project` is missing on purpose: a project workspace snapshots its members
 * from the linked project's team, and projects are web-only admin work. Only
 * the two kinds a phone can fully own are offered.
 */
const TYPES = [
  {
    value: "personal" as WorkspaceType,
    label: "Personal",
    sublabel: "Only you — private even from admins",
    icon: Lock,
  },
  {
    value: "shared" as WorkspaceType,
    label: "Shared",
    sublabel: "Invite people; they accept before joining",
    icon: Users,
  },
];

export default function WorkspaceFormScreen({ route, navigation }: Props) {
  const workspaceId = route.params?.workspaceId;
  const editing = workspaceId != null;

  const { data: workspaces, isLoading } = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => fetchWorkspaces({ PageSize: 100, IncludeArchived: true }),
    enabled: editing,
  });

  const existing = workspaces?.find((w) => w.Id === workspaceId) ?? null;

  if (editing && isLoading) {
    return (
      <Screen>
        <ScreenHeader title="Rename board" onBack={navigation.goBack} />
        <View style={styles.centre}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </Screen>
    );
  }

  return (
    <WorkspaceForm
      navigation={navigation}
      workspace={editing ? existing : null}
    />
  );
}

interface WorkspaceFormProps {
  navigation: Nav;
  workspace: Workspace | null;
}

function WorkspaceForm({ navigation, workspace }: WorkspaceFormProps) {
  const queryClient = useQueryClient();
  const editing = workspace != null;

  const [name, setName] = useState(workspace?.Name ?? "");
  const [type, setType] = useState<WorkspaceType>(workspace?.Type ?? "shared");
  const [members, setMembers] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Only needed while composing the invite list.
  const { data: directory } = useQuery({
    queryKey: ["users", "directory"],
    queryFn: () => fetchUserDirectory(),
    enabled: !editing && type === "shared",
  });

  const memberOptions = useMemo(
    () =>
      (directory ?? []).map((user) => ({
        value: user.Id,
        label: user.FullName,
        sublabel: user.JobTitle ?? user.Username ?? undefined,
      })),
    [directory],
  );

  const save = useMutation({
    mutationFn: saveWorkspace,
    onSuccess: (response) => {
      if (!response.success) {
        setError(response.message || "Could not save this workspace.");
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      navigation.goBack();
    },
    onError: () =>
      setError("Could not save this workspace. Check your connection."),
  });

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give the board a name.");
      return;
    }
    setError(null);
    // sp_SaveWorkspace is a full upsert: Color and Icon have to travel back or
    // a rename silently blanks whatever was set on the web.
    save.mutate({
      Id: workspace?.Id ?? 0,
      Name: trimmed,
      Type: type,
      Color: workspace?.Color ?? null,
      Icon: workspace?.Icon ?? null,
      // Members are invitations, and only shared boards have them. Sending them
      // on an edit would re-invite everyone who already declined.
      Members: !editing && type === "shared" ? members : [],
    });
  };

  return (
    <Screen>
      <ScreenHeader
        title={editing ? "Rename board" : "New board"}
        onBack={navigation.goBack}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Input
          label="Name"
          required
          value={name}
          onChangeText={setName}
          placeholder="Client onboarding"
          autoFocus={!editing}
        />

        {/* Changing type after the fact is a members migration, not a form
            field — convertWorkspaceToShared exists for that, on the web. */}
        {editing ? null : (
          <Select
            label="Kind"
            value={type}
            options={TYPES}
            onChange={(v) => setType(v as WorkspaceType)}
            sheetTitle="What kind of board?"
          />
        )}

        {!editing && type === "shared" ? (
          <Select
            label="Invite"
            value={members}
            options={memberOptions}
            onChange={(v) => setMembers(v as number[])}
            multiple
            placeholder="Nobody yet"
            sheetTitle="Who should join?"
          />
        ) : null}

        {!editing ? (
          <Text variant="caption" color="textMuted">
            New boards start with the basic column set — To do, In progress,
            Done. You can change them straight after.
          </Text>
        ) : null}

        {error ? (
          <Text variant="caption" color="danger">
            {error}
          </Text>
        ) : null}

        <View style={styles.actions}>
          <Button
            title={editing ? "Save changes" : "Create board"}
            onPress={submit}
            loading={save.isPending}
            fullWidth
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centre: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing[6],
  },
  content: {
    padding: SCREEN_PADDING,
    paddingBottom: spacing[20],
    gap: spacing[4],
  },
  actions: { paddingTop: spacing[2] },
});
