import { ScrollView, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { spacing } from "../../theme";
import { EmptyState, PageHeader, Screen } from "../../ui";

// Phase 2 continues: workspace list, then the board for the chosen one.
export default function BoardsScreen() {
  const insets = useSafeAreaInsets();
  return (
    <Screen>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing[4] },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <PageHeader title="Boards" subtitle="Workspaces you own or belong to" />
        <EmptyState
          icon="view-column"
          title="No boards yet"
          message="Shared and personal workspaces will appear here."
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingBottom: spacing[10] },
});
