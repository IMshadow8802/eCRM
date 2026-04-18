import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, Text, View } from "react-native";
import { theme } from "../constants/theme";

const StatCard = ({ label, value, gradient }) => (
  <LinearGradient
    colors={gradient}
    style={styles.statCard}
    start={{ x: 0, y: 0 }}
    end={{ x: 1, y: 1 }}
  >
    <Text style={styles.statLabel}>{label}</Text>
    <Text style={styles.statValue}>{value}</Text>
  </LinearGradient>
);

const StatsCards = ({ totalUsers, activeUsers, totalGroups, labels }) => {
  return (
    <View style={styles.statsContainer}>
      <StatCard
        label={labels?.total || "Total Users"}
        value={totalUsers || 0}
        gradient={["#60A5FA", "#3B82F6"]}
      />
      <StatCard
        label={labels?.active || "Active"}
        value={activeUsers || 0}
        gradient={["#34D399", "#10B981"]}
      />
      <StatCard
        label={labels?.groups || "Groups"}
        value={totalGroups || 0}
        gradient={["#A78BFA", "#8B5CF6"]}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  statsContainer: {
    flexDirection: "row",
    gap: 10,
    marginTop: 0,
  },
  statCard: {
    flex: 1,
    padding: 10,
    borderRadius: 10,
    minHeight: 50,
  },
  statLabel: {
    fontSize: 10,
    color: theme.colors.white,
    opacity: 0.9,
    marginBottom: 4,
    fontWeight: theme.typography.fontWeights.normal,
  },
  statValue: {
    fontSize: 20,
    fontWeight: theme.typography.fontWeights.bold,
    color: theme.colors.white,
  },
});

export default StatsCards;
