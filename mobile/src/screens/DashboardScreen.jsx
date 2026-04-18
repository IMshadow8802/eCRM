import { LinearGradient } from "expo-linear-gradient";
import { useMemo, useState } from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Icon from "react-native-vector-icons/MaterialIcons";
import BigCard from "../components/BigCard";
import ChartIcon from "../components/ChartIcon";
import HeaderWithSearch from "../components/HeaderWithSearch";
import { theme } from "../constants/theme";
import { useProjects } from "../hooks/useProjects";
import { useTasks } from "../hooks/useTasks";
import { useTeams } from "../hooks/useTeams";
import { useUsers } from "../hooks/useUsers";
import { useAuthStore } from "../stores/authStore";

const QuickActionCard = ({ icon, title, color, onPress }) => (
  <View style={styles.actionContainer}>
    <TouchableOpacity
      style={styles.actionCard}
      activeOpacity={0.8}
      onPress={onPress}
    >
      <View style={[styles.actionIcon, { backgroundColor: color }]}>
        {icon}
      </View>
    </TouchableOpacity>
    <Text style={styles.actionTitle}>{title}</Text>
  </View>
);

const TaskCard = ({ title, time, priority }) => (
  <View style={styles.taskCard}>
    <View style={styles.taskCardHeader}>
      <View>
        <Text style={styles.taskTitle}>{title}</Text>
        <View style={styles.taskMeta}>
          <View style={styles.taskTimeContainer}>
            <View style={styles.clockIcon}>
              <View style={styles.clockFace} />
              <View style={styles.clockHand} />
            </View>
            <Text style={styles.taskTime}>{time}</Text>
          </View>
          <View style={[styles.taskPriority, styles[`priority${priority}`]]}>
            <Text style={styles.taskPriorityText}>
              {priority.toUpperCase()}
            </Text>
          </View>
        </View>
      </View>
    </View>
  </View>
);

const DashboardScreen = ({ navigation }) => {
  const [refreshing, setRefreshing] = useState(false);
  const [searchText, setSearchText] = useState("");
  const { user } = useAuthStore();

  // Fetch real data
  const { data: tasks = [], isLoading: tasksLoading, refetch: refetchTasks } = useTasks();
  const { data: projects = [], isLoading: projectsLoading, refetch: refetchProjects } = useProjects();
  const { data: teams = [], refetch: refetchTeams } = useTeams();
  const { data: users = [], refetch: refetchUsers } = useUsers();

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        refetchTasks(),
        refetchProjects(),
        refetchTeams(),
        refetchUsers()
      ]);
    } catch (error) {
      console.error('Error refreshing dashboard data:', error);
    } finally {
      setRefreshing(false);
    }
  };

  // Calculate real statistics
  const stats = useMemo(() => {
    const totalTasks = tasks.length;
    const completedTasks = tasks.filter(task => task.Status === 'done' || task.Status === 'completed').length;
    const inProgressTasks = tasks.filter(task => task.Status === 'in-progress' || task.Status === 'inprogress').length;
    const activeProjects = projects.filter(project => project.IsActive).length;
    
    // Calculate completed this week
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const completedThisWeek = tasks.filter(task => {
      if (!task.CompletedDate) return false;
      const completedDate = new Date(task.CompletedDate);
      return completedDate >= oneWeekAgo && (task.Status === 'done' || task.Status === 'completed');
    }).length;

    // Calculate progress percentage for big card
    const progressPercentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    return {
      totalTasks,
      completedTasks,
      inProgressTasks,
      activeProjects,
      completedThisWeek,
      progressPercentage
    };
  }, [tasks, projects]);

  // Check user permissions using the same logic as drawer
  const hasPermission = (screenName) => {
    const { permissions } = useAuthStore();
    if (!permissions?.menuItems) return false;

    return permissions.menuItems.some(
      (item) => item.description === screenName
    );
  };

  const navigateToScreen = (screen) => {
    navigation.navigate(screen);
  };

  return (
    <View style={styles.container}>
      {/* Dashboard Header */}
      <HeaderWithSearch
        title="Dashboard"
        navigation={navigation}
        searchText={searchText}
        setSearchText={setSearchText}
        searchPlaceholder="Search dashboard..."
        showBigCard={true}
        bigCardContent={
          <BigCard
            title="Your Projects"
            subtitle="Active overview"
            icon={<ChartIcon />}
            progressLabel="Task Progress"
            progressValue={`${stats.completedTasks} of ${stats.totalTasks}`}
            progressPercentage={stats.progressPercentage}
          />
        }
      />

      {/* Dashboard Content */}
      <ScrollView
        style={styles.dashboardContent}
        contentContainerStyle={styles.contentContainer}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Quick Actions */}
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <View style={styles.foldersGrid}>
          {hasPermission("Tasks") && (
            <QuickActionCard
              icon={
                <Icon name="assignment" size={24} color={theme.colors.white} />
              }
              title="Tasks"
              color={theme.colors.primary.brand}
              onPress={() => navigateToScreen("Tasks")}
            />
          )}
          {hasPermission("Projects") && (
            <QuickActionCard
              icon={<Icon name="folder" size={24} color={theme.colors.white} />}
              title="Projects"
              color={theme.colors.status.success}
              onPress={() => navigateToScreen("Projects")}
            />
          )}
          {hasPermission("Teams") && (
            <QuickActionCard
              icon={<Icon name="groups" size={24} color={theme.colors.white} />}
              title="Teams"
              color={theme.colors.status.warning}
              onPress={() => navigateToScreen("Teams")}
            />
          )}
          {hasPermission("Users") && (
            <QuickActionCard
              icon={<Icon name="people" size={24} color={theme.colors.white} />}
              title="Users"
              color="#8B5CF6"
              onPress={() => navigateToScreen("Users")}
            />
          )}
        </View>

        {/* Statistics */}
        <View style={styles.statsRow}>
          <View style={styles.statsGrid}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{stats.totalTasks}</Text>
              <Text style={styles.statLabel}>Total Tasks</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{stats.completedTasks}</Text>
              <Text style={styles.statLabel}>Completed</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{stats.inProgressTasks}</Text>
              <Text style={styles.statLabel}>In Progress</Text>
            </View>
          </View>
        </View>

        {/* Completed This Week */}
        <LinearGradient
          colors={["#34D399", "#10B981"]}
          style={styles.completedCard}
        >
          <View style={styles.completedCardContent}>
            <View>
              <Text style={styles.completedLabel}>Completed This Week</Text>
              <Text style={styles.completedValue}>{stats.completedThisWeek} Tasks</Text>
            </View>
            <View style={styles.completedIcon}>
              <View style={styles.targetIcon}>
                <View style={styles.targetOuter} />
                <View style={styles.targetInner} />
              </View>
            </View>
          </View>
        </LinearGradient>

        {/* Recent Tasks */}
        <Text style={styles.sectionTitle}>Recent Tasks</Text>
        {tasks.slice(0, 3).map((task, index) => (
          <TaskCard
            key={task.Id || index}
            title={task.Title || 'Untitled Task'}
            time={task.CreatedDate ? new Date(task.CreatedDate).toLocaleDateString() : 'No date'}
            priority={task.Priority?.toLowerCase() || 'medium'}
          />
        ))}
        {tasks.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>No tasks available</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.gray[50],
  },
  dashboardContent: {
    flex: 1,
  },
  contentContainer: {
    padding: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: theme.typography.fontWeights.semibold,
    color: theme.colors.gray[800],
    marginBottom: 16,
  },
  foldersGrid: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  actionContainer: {
    width: "23%",
    alignItems: "center",
  },
  actionCard: {
    width: "100%",
    aspectRatio: 1,
    backgroundColor: theme.colors.white,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 8,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  actionTitle: {
    fontSize: 12,
    fontWeight: theme.typography.fontWeights.normal,
    color: theme.colors.gray[800],
    textAlign: "center",
  },
  statsRow: {
    backgroundColor: theme.colors.white,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  statsGrid: {
    flexDirection: "row",
    justifyContent: "space-around",
  },
  statItem: {
    alignItems: "center",
  },
  statValue: {
    fontSize: 24,
    fontWeight: theme.typography.fontWeights.bold,
    color: theme.colors.gray[900],
  },
  statLabel: {
    fontSize: 12,
    color: theme.colors.gray[600],
    marginTop: 4,
  },
  completedCard: {
    borderRadius: 16,
    marginBottom: 16,
  },
  completedCardContent: {
    padding: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  completedLabel: {
    fontSize: 12,
    color: theme.colors.white,
    opacity: 0.9,
  },
  completedValue: {
    fontSize: 24,
    fontWeight: theme.typography.fontWeights.bold,
    color: theme.colors.white,
  },
  completedIcon: {
    width: 32,
    height: 32,
    justifyContent: "center",
    alignItems: "center",
  },
  targetIcon: {
    width: 24,
    height: 24,
    position: "relative",
  },
  targetOuter: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 3,
    borderColor: theme.colors.white,
  },
  targetInner: {
    position: "absolute",
    top: 6,
    left: 6,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: theme.colors.white,
  },
  taskCard: {
    backgroundColor: theme.colors.white,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  taskCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  taskTitle: {
    fontSize: 16,
    fontWeight: theme.typography.fontWeights.semibold,
    color: theme.colors.gray[900],
    marginBottom: 6,
  },
  taskMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  taskTimeContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  clockIcon: {
    width: 12,
    height: 12,
    position: "relative",
  },
  clockFace: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.colors.gray[600],
  },
  clockHand: {
    position: "absolute",
    top: 2,
    left: 5.5,
    width: 1,
    height: 4,
    backgroundColor: theme.colors.gray[600],
    borderRadius: 0.5,
  },
  taskTime: {
    fontSize: 12,
    color: theme.colors.gray[600],
  },
  taskPriority: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  taskPriorityText: {
    fontSize: 10,
    fontWeight: theme.typography.fontWeights.bold,
    color: theme.colors.white,
  },
  priorityhigh: {
    backgroundColor: theme.colors.status.error,
  },
  prioritymedium: {
    backgroundColor: theme.colors.status.warning,
  },
  prioritylow: {
    backgroundColor: theme.colors.status.success,
  },
  emptyState: {
    backgroundColor: theme.colors.white,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 12,
  },
  emptyStateText: {
    fontSize: 14,
    color: theme.colors.gray[500],
    fontStyle: 'italic',
  },
});

export default DashboardScreen;
