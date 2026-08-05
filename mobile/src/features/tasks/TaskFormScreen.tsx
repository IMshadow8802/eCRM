import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Plus, X } from "lucide-react-native";
import type {
  StackNavigationProp,
  StackScreenProps,
} from "@react-navigation/stack";

import { fetchTaskById, saveTask } from "../../api/taskQueries";
import { apiErrorMessage } from "../../api/errors";
import { fetchKanbanColumns } from "../../api/kanbanQueries";
import { fetchWorkspaceMembers } from "../../api/workspaceQueries";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import type { Task, TaskPriority } from "../../types/api";
import { colors, spacing, SCREEN_PADDING } from "../../theme";
import {
  Button,
  DateField,
  Input,
  Screen,
  ScreenHeader,
  ScreenLoader,
  Select,
  Text,
} from "../../ui";
import { assigneesOf } from "./taskHelpers";

type Props = StackScreenProps<RootStackParamList, "TaskForm">;
type Nav = StackNavigationProp<RootStackParamList, "TaskForm">;

const PRIORITIES: { value: TaskPriority; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

const TYPES = ["task", "bug", "feature", "improvement", "research"].map((t) => ({
  value: t,
  label: t[0]!.toUpperCase() + t.slice(1),
}));

/**
 * Create and edit are the same form — the only difference is whether an id
 * goes up with it, and whether the fields start populated.
 *
 * The outer component does nothing but wait for the row. The fields live in a
 * child that takes it as a prop and seeds its state from it, so there is no
 * effect copying server data into local state — and therefore no way for a
 * background refetch to overwrite what someone is typing.
 *
 * Deliberately NOT a bottom sheet: seven fields plus a keyboard leaves nothing
 * of a sheet visible, and the assignee picker opens a sheet of its own.
 */
export default function TaskFormScreen({ route, navigation }: Props) {
  const { workspaceId, taskId, columnId } = route.params;
  const editing = taskId != null;

  const { data: task, isLoading, isError, refetch } = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => fetchTaskById(taskId!),
    enabled: editing,
  });

  if (editing && (isLoading || isError)) {
    return (
      <Screen>
        <ScreenHeader title="Edit task" onBack={navigation.goBack} />
        <ScreenLoader failed={isError} onRetry={refetch} />
      </Screen>
    );
  }

  if (editing && !task) {
    return (
      <Screen>
        <ScreenHeader title="Edit task" onBack={navigation.goBack} />
        <View style={styles.centre}>
          <Lock size={30} color={colors.textMuted} />
          <Text variant="h3">Task not available</Text>
          <Text variant="secondary" align="center">
            It may have been deleted, or you no longer have access to its board.
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <TaskForm
      navigation={navigation}
      workspaceId={workspaceId}
      columnId={columnId ?? null}
      task={task ?? null}
    />
  );
}

interface TaskFormProps {
  navigation: Nav;
  workspaceId: number;
  columnId: number | null;
  task: Task | null;
}

function TaskForm({ navigation, workspaceId, columnId, task }: TaskFormProps) {
  const queryClient = useQueryClient();
  const editing = task != null;

  const [title, setTitle] = useState(task?.Title ?? "");
  const [description, setDescription] = useState(task?.Description ?? "");
  const [priority, setPriority] = useState<TaskPriority>(task?.Priority ?? "medium");
  const [type, setType] = useState(task?.Type ?? "task");
  const [dueDate, setDueDate] = useState<string | null>(
    task?.DueDate ? task.DueDate.slice(0, 10) : null,
  );
  const [column, setColumn] = useState<number | null>(task?.ColumnId ?? columnId);
  const [assignees, setAssignees] = useState<number[]>(() =>
    task ? assigneesOf(task).map((a) => a.UserId) : [],
  );
  const [estimate, setEstimate] = useState(
    task?.EstimatedHours ? String(task.EstimatedHours) : "",
  );
  // Create only. sp_SaveTask rejects a create with no checklist item, because
  // completion is derived from the checklist and a task with an empty one could
  // never complete. Editing ignores this — the checklist is owned by
  // saveTaskChecklist from then on.
  const [steps, setSteps] = useState<string[]>([""]);
  const [error, setError] = useState<string | null>(null);

  const trimmedSteps = steps.map((s) => s.trim()).filter(Boolean);

  const setStep = (idx: number, value: string) =>
    setSteps((prev) => prev.map((s, i) => (i === idx ? value : s)));
  const addStep = () => setSteps((prev) => [...prev, ""]);
  const removeStep = (idx: number) =>
    setSteps((prev) => (prev.length === 1 ? [""] : prev.filter((_, i) => i !== idx)));

  const { data: columns } = useQuery({
    queryKey: ["columns", workspaceId],
    queryFn: () => fetchKanbanColumns({ WorkspaceId: workspaceId }),
  });

  const { data: members } = useQuery({
    queryKey: ["workspace", workspaceId, "members"],
    queryFn: () => fetchWorkspaceMembers({ WorkspaceId: workspaceId }),
  });

  // A pending invite is not a member — offering them as an assignee creates a
  // task nobody can act on.
  const assigneeOptions = useMemo(
    () =>
      (members ?? [])
        .filter((m) => m.InviteStatus === "active" && m.IsActive)
        .map((m) => ({
          value: m.UserId,
          label: m.FullName ?? m.Username ?? `User ${m.UserId}`,
          sublabel: m.Role,
        })),
    [members],
  );

  const columnOptions = useMemo(
    () => (columns ?? []).map((c) => ({ value: c.Id, label: c.Title })),
    [columns],
  );

  const save = useMutation({
    mutationFn: saveTask,
    onSuccess: (response) => {
      if (!response.success) {
        setError(response.message || "Could not save this task.");
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      if (task) queryClient.invalidateQueries({ queryKey: ["task", task.Id] });
      navigation.goBack();
    },
    onError: (err) =>
      setError(apiErrorMessage(err, "Could not save this task. Check your connection.")),
  });

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) {
      setError("A task needs a title.");
      return;
    }
    if (!editing && trimmedSteps.length === 0) {
      setError("Add at least one step — that is what marks the task done.");
      return;
    }
    setError(null);

    const hours = Number(estimate);

    save.mutate({
      Id: task?.Id ?? 0,
      Title: trimmed,
      Description: description.trim(),
      WorkspaceId: workspaceId,
      ColumnId: column,
      AssigneeIds: assignees,
      Priority: priority,
      Type: type,
      DueDate: dueDate,
      EstimatedHours: Number.isFinite(hours) && hours > 0 ? hours : 0,
      // sp_SaveTask's UPDATE branch assigns every one of these columns
      // unconditionally — only ColumnId is COALESCEd. Omitting them here does
      // not mean "leave them alone": saveTask's own defaults would fill in
      // 0/null and the save would wipe logged time, progress, the parent link
      // and the project. So this form re-sends what it does not edit.
      ParentTaskId: task?.ParentTaskId ?? null,
      ProjectId: task?.ProjectId ?? null,
      TeamId: task?.TeamId ?? null,
      LoggedHours: task?.LoggedHours ?? 0,
      Progress: task?.Progress ?? 0,
      IsBlocked: task?.IsBlocked ?? false,
      Labels: task?.Labels ?? null,
      Watchers: task?.Watchers ?? null,
      // Ignored on update; required on create.
      ChecklistItems: editing ? null : trimmedSteps,
    });
  };

  return (
    <Screen>
      <ScreenHeader
        title={editing ? "Edit task" : "New task"}
        subtitle={task?.WorkspaceName ?? undefined}
        onBack={navigation.goBack}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Input
          label="Title"
          required
          value={title}
          onChangeText={setTitle}
          placeholder="What needs doing?"
          autoFocus={!editing}
        />

        <Input
          label="Description"
          value={description}
          onChangeText={setDescription}
          placeholder="Any detail worth keeping"
          multiline
          numberOfLines={4}
        />

        <Select
          label="Column"
          value={column}
          options={columnOptions}
          onChange={(v) => setColumn(v as number)}
          placeholder="Board default"
        />

        <Select
          label="Assignees"
          value={assignees}
          options={assigneeOptions}
          onChange={(v) => setAssignees(v as number[])}
          multiple
          placeholder="Nobody yet"
          sheetTitle="Who is on this?"
        />

        <Select
          label="Priority"
          value={priority}
          options={PRIORITIES}
          onChange={(v) => setPriority(v as TaskPriority)}
        />

        <Select
          label="Type"
          value={type}
          options={TYPES}
          onChange={(v) => setType(v as string)}
        />

        <DateField label="Due date" value={dueDate} onChange={setDueDate} />

        <Input
          label="Estimated hours"
          value={estimate}
          onChangeText={setEstimate}
          placeholder="0"
          keyboardType="decimal-pad"
        />

        {!editing ? (
          <View style={styles.steps}>
            <Text variant="label">Steps *</Text>
            <Text variant="caption" color="textMuted">
              Break the work into steps. The task completes when every step is
              ticked.
            </Text>
            {steps.map((step, idx) => (
              <View key={idx} style={styles.stepRow}>
                <View style={styles.stepInput}>
                  <Input
                    value={step}
                    onChangeText={(v) => setStep(idx, v)}
                    placeholder={`Step ${idx + 1}`}
                  />
                </View>
                <Pressable
                  onPress={() => removeStep(idx)}
                  hitSlop={8}
                  accessibilityLabel={`Remove step ${idx + 1}`}
                  style={styles.stepRemove}
                >
                  <X size={18} color={colors.textMuted} />
                </Pressable>
              </View>
            ))}
            <Pressable onPress={addStep} hitSlop={8} style={styles.stepAdd}>
              <Plus size={16} color={colors.primary} />
              <Text variant="label" color="primary">
                Add step
              </Text>
            </Pressable>
          </View>
        ) : null}

        {error ? (
          <Text variant="caption" color="danger">
            {error}
          </Text>
        ) : null}

        <View style={styles.actions}>
          <Button
            title={editing ? "Save changes" : "Create task"}
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
    gap: spacing[2],
    padding: spacing[6],
  },
  content: {
    padding: SCREEN_PADDING,
    paddingBottom: spacing[20],
    gap: spacing[4],
  },
  actions: { paddingTop: spacing[2] },
  steps: { gap: spacing[2] },
  stepRow: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  stepInput: { flex: 1 },
  stepRemove: { padding: spacing[2] },
  stepAdd: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    paddingVertical: spacing[1],
  },
});
