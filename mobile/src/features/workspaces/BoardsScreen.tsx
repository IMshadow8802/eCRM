import { StyleSheet, Text, View } from "react-native";

import theme from "../../constants/theme";
import { getFontFamily } from "../../constants/fonts";

// Phase 2 fills this in: workspace picker then that board's columns.
export default function BoardsScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Boards</Text>
      <Text style={styles.hint}>Your workspace boards land here.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  title: { fontSize: 20, fontFamily: getFontFamily("semibold"), color: theme.colors.gray[900] },
  hint: { marginTop: 6, fontSize: 14, fontFamily: getFontFamily("regular"), color: theme.colors.gray[500] },
});
