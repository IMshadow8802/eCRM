import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, TouchableOpacity, View } from "react-native";
import { theme } from "../constants/theme";
import { AddIcon } from "./Icons";

const FAB = ({ onPress, icon }) => {
  return (
    <TouchableOpacity style={styles.fab} onPress={onPress} activeOpacity={0.8}>
      <LinearGradient
        colors={["#FF7AB7", "#F9629F"]}
        style={styles.fabGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <View style={styles.fabIcon}>{icon || <AddIcon size={24} />}</View>
      </LinearGradient>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    bottom: 20,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 16,
    shadowColor: "#F9629F",
    shadowOffset: {
      width: 0,
      height: 10,
    },
    shadowOpacity: 0.4,
    shadowRadius: 25,
    elevation: 8,
    zIndex: 10,
  },
  fabGradient: {
    width: "100%",
    height: "100%",
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  fabIcon: {
    justifyContent: "center",
    alignItems: "center",
  },
  plusIcon: {
    width: 28,
    height: 28,
    justifyContent: "center",
    alignItems: "center",
  },
  plusLine: {
    position: "absolute",
    backgroundColor: theme.colors.white,
    borderRadius: 2,
    width: 28,
    height: 3,
  },
  plusLineVertical: {
    width: 3,
    height: 28,
  },
});

export default FAB;
