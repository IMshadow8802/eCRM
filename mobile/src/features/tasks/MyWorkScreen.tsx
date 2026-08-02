import { StyleSheet, Text, View } from "react-native";

import theme from "../../constants/theme";
import { getFontFamily } from "../../constants/fonts";

// Phase 2 fills this in: tasks assigned to me across every workspace, grouped
// Overdue / Today / This week / Later. fetchTasks({ WorkspaceId: null }) plus a
// client-side assignee filter — see spec §5.1.
export default function MyWorkScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>My Work</Text>
      <Text style={styles.hint}>Tasks assigned to you land here.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  title: { fontSize: 20, fontFamily: getFontFamily("semibold"), color: theme.colors.gray[900] },
  hint: { marginTop: 6, fontSize: 14, fontFamily: getFontFamily("regular"), color: theme.colors.gray[500] },
});
