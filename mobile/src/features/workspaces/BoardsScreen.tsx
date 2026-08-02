import { EmptyState, Screen } from "../../ui";

// Phase 2 fills this in: workspace picker, then that board's columns.
export default function BoardsScreen() {
  return (
    <Screen>
      <EmptyState
        icon="view-column"
        title="No boards yet"
        message="Workspaces you own or belong to will appear here."
      />
    </Screen>
  );
}
