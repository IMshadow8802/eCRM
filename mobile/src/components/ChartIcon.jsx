import { StyleSheet, View } from "react-native";
import { theme } from "../constants/theme";

const ChartIcon = ({ size = 20, color = theme.colors.white }) => {
  return (
    <View style={[styles.chartIcon, { width: size, height: size * 0.8 }]}>
      <View style={[styles.chartBar, { backgroundColor: color }]} />
      <View
        style={[
          styles.chartBar,
          styles.chartBarMedium,
          { backgroundColor: color },
        ]}
      />
      <View
        style={[
          styles.chartBar,
          styles.chartBarTall,
          { backgroundColor: color },
        ]}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  chartIcon: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "center",
    gap: 2,
  },
  chartBar: {
    width: 4,
    height: 6,
    borderRadius: 2,
  },
  chartBarMedium: {
    height: 10,
  },
  chartBarTall: {
    height: 14,
  },
});

export default ChartIcon;
