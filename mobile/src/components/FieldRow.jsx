import React from "react";
import { StyleSheet, View } from "react-native";

const FieldRow = ({ children, spacing = 12 }) => {
  return (
    <View style={[styles.row, { gap: spacing }]}>
      {React.Children.map(children, (child, index) => (
        <View key={index} style={styles.field}>
          {child}
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  field: {
    flex: 1,
  },
});

export default FieldRow;
