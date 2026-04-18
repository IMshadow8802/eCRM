import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Dimensions,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import AddTaskModal from "../components/AddTaskModal";
import HeaderFilters from "../components/HeaderFilters";
import HeaderWithSearch from "../components/HeaderWithSearch";
import TaskCard from "../components/TaskCard";
import TaskModal from "../components/TaskModal";
import { theme } from "../constants/theme";
import { useKanbanColumns } from "../hooks/useKanban";
import { useProjects } from "../hooks/useProjects";
import { useCreateTask, useTasks, useUpdateTask } from "../hooks/useTasks";
import { useTeams } from "../hooks/useTeams";
import { useUsers } from "../hooks/useUsers";

const { width: screenWidth } = Dimensions.get("window");

const TasksScreen = ({ navigation }) => {
  const [searchText, setSearchText] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [selectedProject, setSelectedProject] = useState(null); // Will be set to first project when data loads

  // Add task modal state
  const [showAddTaskModal, setShowAddTaskModal] = useState(false);
  const [selectedColumnForAdd, setSelectedColumnForAdd] = useState(null);
  
  // Task edit modal state
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);

  // Mutations for updating and creating tasks
  const updateTaskMutation = useUpdateTask();
  const createTaskMutation = useCreateTask();

  // Fetch data
  const { data: projects = [], isLoading: projectsLoading } = useProjects();
  const { data: kanbanColumns = [], isLoading: columnsLoading } =
    useKanbanColumns(selectedProject);
  const { data: tasks = [], isLoading: tasksLoading } = useTasks(
    searchText,
    selectedProject,
    selectedStatus !== "all" ? selectedStatus : null
  );
  const { data: users = [] } = useUsers();
  const { data: teams = [] } = useTeams();

  // Set default project to first project when projects load
  useEffect(() => {
    if (projects.length > 0 && selectedProject === null) {
      setSelectedProject(projects[0].Id);
    }
  }, [projects, selectedProject]);


  // Filter columns based on selected status and sort by SortOrder
  const filteredColumns = useMemo(() => {
    let columns = kanbanColumns.filter((column) => column.IsActive);

    if (selectedStatus !== "all") {
      // Convert selectedStatus to number for comparison with column.Id
      columns = columns.filter((column) => column.Id === parseInt(selectedStatus));
    }

    return columns.sort((a, b) => a.SortOrder - b.SortOrder);
  }, [kanbanColumns, selectedStatus]);

  // Calculate stats
  const totalTasks = tasks.length;
  const activeColumns = kanbanColumns.filter(
    (column) => column.IsActive
  ).length;

  // Group tasks by status - convert task.Status string to number for comparison
  const getTasksForColumn = (columnId) => {
    return tasks.filter((task) => parseInt(task.Status) === columnId);
  };

  const handleTaskPress = (task) => {
    setSelectedTask(task);
    setShowTaskModal(true);
  };

  // Handle moving task to different column
  const handleMoveTask = async (task, targetColumnId) => {

    // Find target column
    const targetColumn = kanbanColumns.find((col) => col.Id === targetColumnId);
    const targetColumnTasks = getTasksForColumn(targetColumnId);

    // Validation: Check max tasks limit
    if (
      targetColumn?.MaxTasks &&
      targetColumnTasks.length >= targetColumn.MaxTasks
    ) {
      Alert.alert(
        "Column Full",
        `Column "${targetColumn.Title}" is at capacity (${targetColumnTasks.length}/${targetColumn.MaxTasks})`
      );
      return;
    }

    // Don't move if already in the same column (compare Status string with targetColumnId number)
    if (parseInt(task.Status) === targetColumnId) {
      return;
    }

    try {
      // Prepare updated task data - convert targetColumnId number to string for Status
      const updatedTask = {
        ...task,
        Status: targetColumnId.toString(),
      };

      // Call API to update task
      await updateTaskMutation.mutateAsync(updatedTask);

    } catch (error) {
      console.error("Failed to update task status:", error);
      Alert.alert("Error", "Failed to move task. Please try again.");
    }
  };

  // Handle opening add task modal
  const handleAddTask = (column) => {
    setSelectedColumnForAdd(column);
    setShowAddTaskModal(true);
  };

  // Handle creating new task
  const handleCreateTask = async (taskData) => {
    try {
      await createTaskMutation.mutateAsync(taskData);
    } catch (error) {
      console.error("Failed to create task:", error);
      Alert.alert("Error", "Failed to create task. Please try again.");
    }
  };

  const KanbanColumn = ({ column }) => {
    const columnTasks = getTasksForColumn(column.Id);

    return (
      <View style={styles.columnContainer}>
        {/* Column Header with solid color */}
        <View style={[styles.columnHeader, { backgroundColor: column.Color }]}>
          <View style={styles.columnHeaderContent}>
            <View style={styles.titleSection}>
              <Text style={styles.columnTitle}>{column.Title}</Text>
              <View style={styles.columnStats}>
                <Text style={styles.taskCount}>{columnTasks.length}</Text>
                {column.MaxTasks && (
                  <Text style={styles.maxTasks}>/{column.MaxTasks}</Text>
                )}
              </View>
            </View>
            <TouchableOpacity
              style={styles.addButton}
              onPress={() => handleAddTask(column)}
            >
              <Text style={styles.addButtonText}>Add</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Column Content */}
        <View style={styles.columnContent}>
          {columnTasks.length === 0 ? (
            <View style={styles.emptyColumn}>
              <View style={styles.emptyIcon}>
                <Text style={styles.emptyIconText}>📋</Text>
              </View>
              <Text style={styles.emptyTitle}>No tasks yet</Text>
              <Text style={styles.emptySubtitle}>Drop tasks here</Text>
            </View>
          ) : (
            <View style={styles.tasksList}>
              {columnTasks.map((item) => (
                <TaskCard
                  key={item.Id}
                  task={item}
                  onPress={handleTaskPress}
                  kanbanColumns={kanbanColumns}
                  onMoveTask={handleMoveTask}
                />
              ))}
            </View>
          )}
        </View>
      </View>
    );
  };

  if (
    (columnsLoading && kanbanColumns.length === 0) ||
    (tasksLoading && tasks.length === 0)
  ) {
    return (
      <View style={styles.container}>
        <HeaderWithSearch
          title="Tasks"
          navigation={navigation}
          searchText={searchText}
          setSearchText={setSearchText}
          searchPlaceholder="Search tasks..."
        />
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading kanban board...</Text>
        </View>
      </View>
    );
  }

  // Filter configuration for HeaderWithSearch
  const filterConfig = {
    renderFilters: () => (
      <HeaderFilters
        selectedStatus={selectedStatus}
        selectedProject={selectedProject}
        onStatusChange={setSelectedStatus}
        onProjectChange={setSelectedProject}
        projects={projects}
        kanbanColumns={kanbanColumns}
      />
    ),
  };

  return (
    <View style={styles.container}>
      {/* Header with integrated filters */}
      <HeaderWithSearch
        title="Tasks"
        navigation={navigation}
        searchText={searchText}
        setSearchText={setSearchText}
        searchPlaceholder="Search tasks..."
        showFilters={true}
        filterConfig={filterConfig}
        statsData={{
          totalUsers: totalTasks,
          activeUsers: activeColumns,
          totalGroups: projects.length,
          labels: {
            total: "Total Tasks",
            active: "Active Columns",
            groups: "Projects",
          },
        }}
      />

      {/* Kanban Board */}
      <ScrollView
        style={styles.kanbanContainer}
        showsVerticalScrollIndicator={false}
      >
        {filteredColumns.length === 0 ? (
          <View style={styles.emptyBoard}>
            <Text style={styles.emptyBoardText}>No columns found</Text>
          </View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.kanbanScrollContent}
            nestedScrollEnabled={true}
          >
            {filteredColumns.map((column, index) => (
              <React.Fragment key={column.Id}>
                <KanbanColumn column={column} />
                {index < filteredColumns.length - 1 && (
                  <View style={styles.columnSeparator} />
                )}
              </React.Fragment>
            ))}
          </ScrollView>
        )}
      </ScrollView>

      {/* Add Task Modal */}
      <AddTaskModal
        visible={showAddTaskModal}
        onClose={() => setShowAddTaskModal(false)}
        onCreateTask={handleCreateTask}
        columnId={selectedColumnForAdd?.Id}
        columnTitle={selectedColumnForAdd?.Title}
        projects={projects}
        teams={teams}
        users={users}
        currentProject={selectedProject}
      />

      {/* Task Edit Modal */}
      <TaskModal
        visible={showTaskModal}
        task={selectedTask}
        onClose={() => {
          setShowTaskModal(false);
          setSelectedTask(null);
        }}
        onTaskUpdated={(updatedTask) => {
          // The task will be automatically updated via React Query cache invalidation
        }}
        kanbanColumns={kanbanColumns}
        permissions={{
          canEdit: false, // Only task creator can edit (handled in TaskModal)
          canDelete: false
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.gray[50],
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    fontSize: theme.typography.fontSizes.base,
    color: theme.colors.gray[600],
  },
  kanbanContainer: {
    flex: 1,
    paddingTop: 16,
  },
  kanbanScrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 20,
    alignItems: 'flex-start', // Prevent columns from stretching vertically
  },
  columnContainer: {
    width: screenWidth - 32, // Full width minus padding
    backgroundColor: theme.colors.white,
    borderRadius: 14,
    marginRight: 16,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 5,
    overflow: "hidden",
    alignSelf: 'flex-start', // Important: don't stretch to fill container height
  },
  columnSeparator: {
    width: 0,
  },
  columnHeader: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
  },
  columnHeaderContent: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  titleSection: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  columnTitle: {
    fontSize: 18,
    fontWeight: theme.typography.fontWeights.bold,
    color: theme.colors.white,
    marginRight: 8,
  },
  columnStats: {
    flexDirection: "row",
    alignItems: "baseline",
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.3)",
  },
  taskCount: {
    fontSize: 16,
    fontWeight: theme.typography.fontWeights.bold,
    color: theme.colors.white,
  },
  maxTasks: {
    fontSize: 14,
    color: theme.colors.white + "80",
    marginLeft: 2,
  },
  addButton: {
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.3)",
  },
  addButtonText: {
    color: theme.colors.white,
    fontSize: 12,
    fontWeight: theme.typography.fontWeights.semibold,
  },
  columnContent: {
    padding: 20,
    backgroundColor: theme.colors.white,
  },
  emptyColumn: {
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 60,
  },
  emptyIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: theme.colors.gray[100],
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  emptyIconText: {
    fontSize: 24,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: theme.typography.fontWeights.semibold,
    color: theme.colors.gray[700],
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: theme.colors.gray[500],
    textAlign: "center",
    lineHeight: 20,
  },
  tasksList: {
    // No flex constraints - let it grow naturally
  },
  tasksPlaceholder: {
    fontSize: 14,
    color: theme.colors.gray[600],
    textAlign: "center",
    paddingVertical: 40,
    fontStyle: "italic",
  },
  emptyBoard: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: 100,
  },
  emptyBoardText: {
    fontSize: theme.typography.fontSizes.base,
    color: theme.colors.gray[500],
    textAlign: "center",
  },
});

export default TasksScreen;
