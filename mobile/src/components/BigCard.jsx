import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, Text, View } from "react-native";
import { theme } from "../constants/theme";

const BigCard = ({
  title,
  subtitle,
  icon,
  progressLabel,
  progressValue,
  progressPercentage = 65,
  gradientColors = [
    theme.colors.primary.brand,
    theme.colors.primary.brandLight,
  ],
}) => {
  return (
    <LinearGradient
      colors={gradientColors}
      style={styles.bigCard}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
    >
      <View style={styles.cardHeader}>
        <View>
          <Text style={styles.cardTitle}>{title}</Text>
          <Text style={styles.cardSubtitle}>{subtitle}</Text>
        </View>
        <View style={styles.cardIcon}>{icon}</View>
      </View>
      <View style={styles.cardContent}>
        <Text style={styles.progressLabel}>{progressLabel}</Text>
        <Text style={styles.progressValue}>{progressValue}</Text>
        <View style={styles.progressContainer}>
          <View
            style={[styles.progressBar, { width: `${progressPercentage}%` }]}
          />
        </View>
      </View>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  bigCard: {
    borderRadius: 18,
    padding: 18,
    position: "relative",
    overflow: "hidden",
    shadowColor: theme.colors.primary.brand,
    shadowOffset: {
      width: 0,
      height: 10,
    },
    shadowOpacity: 0.3,
    shadowRadius: 25,
    elevation: 10,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 15,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: theme.typography.fontWeights.semibold,
    color: theme.colors.white,
    marginBottom: 3,
  },
  cardSubtitle: {
    fontSize: 12,
    color: theme.colors.white,
    opacity: 0.9,
  },
  cardIcon: {
    width: 28,
    height: 28,
    justifyContent: "center",
    alignItems: "center",
  },
  cardContent: {
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 12,
    padding: 12,
  },
  progressLabel: {
    fontSize: 11,
    color: theme.colors.white,
    opacity: 0.9,
    marginBottom: 6,
  },
  progressValue: {
    fontSize: 20,
    fontWeight: theme.typography.fontWeights.bold,
    color: theme.colors.white,
  },
  progressContainer: {
    height: 4,
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 2,
    marginTop: 8,
    overflow: "hidden",
  },
  progressBar: {
    height: "100%",
    backgroundColor: theme.colors.white,
    borderRadius: 2,
  },
});

export default BigCard;
