import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Users } from "lucide-react-native";
import type {
  StackNavigationProp,
  StackScreenProps,
} from "@react-navigation/stack";

import { fetchUserDirectory } from "../../api/userQueries";
import { fetchWorkspaces, saveWorkspace } from "../../api/workspaceQueries";
import { apiErrorMessage } from "../../api/errors";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import type { Workspace, WorkspaceType } from "../../types/api";
import { metrics, spacing } from "../../theme";
import {
  Band,
  BandSheet,
  ErrorCard,
  FieldHelp,
  HeaderButton,
  Input,
  Screen,
  Select,
  SkeletonRows,
  useLayout,
} from "../../ui";

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

/** The keys sp_ApplyKanbanTemplate knows — same list as the web's create modal. */
const TEMPLATES = [
  { value: "basic", label: "Basic", sublabel: "To Do / In Progress / Done" },
  { value: "scrum", label: "Scrum", sublabel: "Backlog / Sprint / In Progress / Review / Done" },
  { value: "bug", label: "Bug Triage", sublabel: "New / Triaged / In Progress / Fixed / Verified" },
  { value: "content", label: "Content", sublabel: "Idea / Draft / Review / Published" },
];

export default function WorkspaceFormScreen({ route, navigation }: Props) {
  const workspaceId = route.params?.workspaceId;
  const editing = workspaceId != null;

  const { data: workspaces, isLoading, isError, refetch } = useQuery({
    queryKey: ["workspaces", true],
    queryFn: () => fetchWorkspaces({ PageSize: 100, IncludeArchived: true }),
    enabled: editing,
  });

  const existing = workspaces?.find((w) => w.Id === workspaceId) ?? null;

  if (editing && (isLoading || isError)) {
    return (
      <Screen band>
        <Band title="Rename board" variant="record" backIcon="close" onBack={navigation.goBack} />
        <BandSheet scroll>
          {isError ? <ErrorCard onRetry={() => void refetch()} /> : <SkeletonRows rows={3} />}
        </BandSheet>
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
  const layout = useLayout();
  const editing = workspace != null;

  const [name, setName] = useState(workspace?.Name ?? "");
  const [type, setType] = useState<WorkspaceType>(workspace?.Type ?? "shared");
  const [members, setMembers] = useState<number[]>([]);
  const [template, setTemplate] = useState("basic");
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
    onError: (err) =>
      setError(
        apiErrorMessage(err, "Could not save this workspace. Check your connection."),
      ),
  });

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give the board a name.");
      return;
    }
    setError(null);
    // sp_SaveWorkspace is a full upsert: TeamId, ProjectId, Color and Icon have
    // to travel back or a rename blanks them (a project board without its
    // ProjectId is refused outright).
    save.mutate({
      Id: workspace?.Id ?? 0,
      Name: trimmed,
      Type: type,
      TeamId: workspace?.TeamId ?? null,
      ProjectId: workspace?.ProjectId ?? null,
      Color: workspace?.Color ?? null,
      Icon: workspace?.Icon ?? null,
      // Members are invitations, and only shared boards have them. Sending them
      // on an edit would re-invite everyone who already declined.
      Members: !editing && type === "shared" ? members : [],
      // Columns are seeded on create only; an edit never re-applies one.
      ...(editing ? {} : { TemplateKey: template }),
    });
  };

  return (
    <Screen band>
      {/* 16's pattern: Save in the band. */}
      <Band
        title={editing ? "Rename board" : "New board"}
        variant="record"
        backIcon="close"
        onBack={navigation.goBack}
        actions={
          <HeaderButton
            label={save.isPending ? "Saving…" : "Save"}
            onPress={submit}
            disabled={save.isPending}
            accessibilityLabel={editing ? "Save changes" : "Create board"}
          />
        }
      />

      <BandSheet scroll contentBottom={spacing[10]}>
        <View style={[styles.form, { maxWidth: layout.contentMaxWidth }]}>
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
          <Select
            label="Columns"
            value={template}
            options={TEMPLATES}
            onChange={(v) => setTemplate(v as string)}
            sheetTitle="Start with which columns?"
          />
        ) : null}

        {error ? <FieldHelp error={error} /> : null}
        </View>
      </BandSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { width: "100%", alignSelf: "center", gap: metrics.fieldGap },
});
