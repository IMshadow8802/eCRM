import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { theme } from "../constants/theme";
import { useAuthStore } from "../stores/authStore";

const MinimalHeader = ({ title, navigation, showSearch = false }) => (
  <SafeAreaView style={styles.dashboardHeader} edges={["top"]}>
    <View style={styles.headerTop}>
      <TouchableOpacity
        style={styles.menuBtn}
        onPress={() => navigation?.openDrawer()}
      >
        <Text style={styles.menuIcon}>☰</Text>
      </TouchableOpacity>
      <Text style={styles.headerTitle}>{title}</Text>
      <View style={styles.headerActions}>
        {showSearch && (
          <TouchableOpacity style={styles.iconBtn}>
            <Text style={styles.iconBtnText}>🔍</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  </SafeAreaView>
);

const PlaceholderScreen = ({
  title,
  description,
  icon = "🚧",
  navigation,
  showSearch = false,
}) => {
  const { hasPermission } = useAuthStore();

  return (
    <View style={styles.container}>
      <MinimalHeader
        title={title}
        navigation={navigation}
        showSearch={showSearch}
      />
      <View style={styles.content}>
        <Text style={styles.icon}>{icon}</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description}>
          {description || `${title} functionality coming soon...`}
        </Text>

        <View style={styles.infoContainer}>
          <Text style={styles.infoText}>This screen will include:</Text>
          <Text style={styles.bulletPoint}>• Full CRUD operations</Text>
          <Text style={styles.bulletPoint}>• Data filtering and search</Text>
          <Text style={styles.bulletPoint}>• Real-time updates</Text>
          <Text style={styles.bulletPoint}>• Permission-based access</Text>
        </View>

        <TouchableOpacity style={styles.backButton}>
          <Text style={styles.backButtonText}>Under Development</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

// Specific placeholder screens
export const TasksScreen = ({ navigation }) => (
  <PlaceholderScreen
    title="Tasks"
    description="Manage tasks with Kanban board, drag & drop functionality, and team assignments."
    icon="📋"
    navigation={navigation}
    showSearch={true}
  />
);

export const ProjectsScreen = ({ navigation }) => (
  <PlaceholderScreen
    title="Projects"
    description="Create and manage projects with team assignments and progress tracking."
    icon="📁"
    navigation={navigation}
  />
);

export const TeamsScreen = () => (
  <PlaceholderScreen
    title="Team Management"
    description="Manage teams, assign members, and track team performance."
    icon="👥"
  />
);

export const UsersScreen = () => (
  <PlaceholderScreen
    title="User Management"
    description="Manage user accounts, roles, and permissions."
    icon="👤"
  />
);

export const KanbanConfigScreen = () => (
  <PlaceholderScreen
    title="Kanban Configuration"
    description="Configure Kanban board columns, colors, and workflow settings."
    icon="⚙️"
  />
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.gray[50],
  },
  dashboardHeader: {
    backgroundColor: theme.colors.white,
    paddingHorizontal: 20,
    paddingTop: 15,
    paddingBottom: 20,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 3,
    },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
  },
  headerTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  menuBtn: {
    width: 36,
    height: 36,
    backgroundColor: theme.colors.gray[50],
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  menuIcon: {
    fontSize: 16,
    color: theme.colors.gray[600],
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: theme.typography.fontWeights.bold,
    color: theme.colors.gray[900],
  },
  headerActions: {
    flexDirection: "row",
    gap: 8,
  },
  iconBtn: {
    width: 36,
    height: 36,
    backgroundColor: theme.colors.gray[50],
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  iconBtnText: {
    fontSize: 16,
  },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: theme.spacing[6],
  },
  icon: {
    fontSize: 64,
    marginBottom: theme.spacing[4],
  },
  title: {
    fontSize: theme.typography.fontSizes["2xl"],
    fontWeight: theme.typography.fontWeights.bold,
    color: theme.colors.gray[800],
    textAlign: "center",
    marginBottom: theme.spacing[3],
  },
  description: {
    fontSize: theme.typography.fontSizes.base,
    color: theme.colors.gray[600],
    textAlign: "center",
    marginBottom: theme.spacing[6],
    lineHeight:
      theme.typography.lineHeights.relaxed * theme.typography.fontSizes.base,
  },
  infoContainer: {
    backgroundColor: theme.colors.white,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing[4],
    marginBottom: theme.spacing[6],
    ...theme.shadows.sm,
    width: "100%",
    maxWidth: 300,
  },
  infoText: {
    fontSize: theme.typography.fontSizes.sm,
    fontWeight: theme.typography.fontWeights.semibold,
    color: theme.colors.gray[700],
    marginBottom: theme.spacing[3],
    textAlign: "center",
  },
  bulletPoint: {
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.gray[600],
    marginBottom: theme.spacing[1],
    paddingLeft: theme.spacing[2],
  },
  backButton: {
    backgroundColor: theme.colors.gray[300],
    borderRadius: theme.borderRadius.base,
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[6],
  },
  backButtonText: {
    fontSize: theme.typography.fontSizes.base,
    fontWeight: theme.typography.fontWeights.normal,
    color: theme.colors.gray[700],
  },
});

export default PlaceholderScreen;
