import { EmptyState, Screen } from "../../ui";

// Phase 2 fills this in: tasks assigned to me across every workspace, grouped
// Overdue / Today / This week. fetchTasks({ WorkspaceId: null }) plus a
// client-side assignee filter — see spec §5.1.
export default function MyWorkScreen() {
  return (
    <Screen>
      <EmptyState
        icon="check-circle-outline"
        title="Nothing assigned yet"
        message="Tasks assigned to you across every workspace will appear here."
      />
    </Screen>
  );
}
