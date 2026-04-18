//zustand/useTaskStore.js
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { findUserById } from "../utils/userShape";

// Static task data that doesn't change often
const STATIC_TASK_DATA = {
  KANBAN_COLUMNS: [
    {
      id: "backlog",
      title: "Backlog",
      color: "#A78BFA",
      sortOrder: 1,
      maxTasks: null,
      isActive: true,
    },
    {
      id: "todo",
      title: "To Do",
      color: "#60A5FA",
      sortOrder: 2,
      maxTasks: null,
      isActive: true,
    },
    {
      id: "in-progress",
      title: "In Progress",
      color: "#FBBF24",
      sortOrder: 3,
      maxTasks: 5,
      isActive: true,
    },
    {
      id: "review",
      title: "In Review",
      color: "#C084FC",
      sortOrder: 4,
      maxTasks: 3,
      isActive: true,
    },
    {
      id: "testing",
      title: "Testing",
      color: "#FB7185",
      sortOrder: 5,
      maxTasks: 2,
      isActive: true,
    },
    {
      id: "done",
      title: "Completed",
      color: "#34D399",
      sortOrder: 6,
      maxTasks: null,
      isActive: true,
    },
  ],

  PRIORITIES: [
    { id: "low", name: "Low", color: "success" },
    { id: "medium", name: "Medium", color: "warning" },
    { id: "high", name: "High", color: "error" },
  ],

  // icon key maps to a lucide-react icon name rendered at the call site
  TASK_TYPES: [
    { id: "task", name: "Task", icon: "ClipboardList" },
    { id: "feature", name: "Feature", icon: "Sparkles" },
    { id: "bug", name: "Bug", icon: "Bug" },
    { id: "improvement", name: "Improvement", icon: "Zap" },
    { id: "documentation", name: "Documentation", icon: "BookOpen" },
    { id: "testing", name: "Testing", icon: "TestTube" },
    { id: "epic", name: "Epic", icon: "Folder" },
  ],

  STATUS_TRANSITIONS: {
    backlog: ["todo", "in-progress"],
    todo: ["backlog", "in-progress"],
    "in-progress": ["todo", "review", "testing"],
    review: ["in-progress", "testing", "done"],
    testing: ["review", "done", "in-progress"],
    done: ["testing", "review"],
  },
};

const useTaskStore = create(
  persist(
    (set, get) => ({
      // Static data
      kanbanColumns: STATIC_TASK_DATA.KANBAN_COLUMNS,
      priorities: STATIC_TASK_DATA.PRIORITIES,
      taskTypes: STATIC_TASK_DATA.TASK_TYPES,
      statusTransitions: STATIC_TASK_DATA.STATUS_TRANSITIONS,

      // Dynamic data from API
      tasks: [],
      projects: [],
      teams: [],
      users: [],

      // Loading states
      isLoadingTasks: false,
      isLoadingProjects: false,
      isLoadingTeams: false,
      isLoadingUsers: false,
      isLoadingInitialData: false,

      // Filter states
      filters: {
        selectedProject: "",
        selectedTeam: "all",
        selectedPriority: "all",
        selectedAssignee: "all",
        searchTerm: "",
        showFilters: false,
      },

      // UI states
      draggedTask: null,
      dragOverColumn: null,
      selectedTask: null,
      showCreateModal: false,
      showTaskModal: false,

      // Error states
      errors: {
        tasks: null,
        projects: null,
        teams: null,
        users: null,
      },

      // ==================== SETTERS ====================

      setTasks: (tasks) => set({ tasks }),
      setProjects: (projects) => set({ projects }),
      setTeams: (teams) => set({ teams }),
      setUsers: (users) => set({ users }),

      setLoadingTasks: (loading) => set({ isLoadingTasks: loading }),
      setLoadingProjects: (loading) => set({ isLoadingProjects: loading }),
      setLoadingTeams: (loading) => set({ isLoadingTeams: loading }),
      setLoadingUsers: (loading) => set({ isLoadingUsers: loading }),
      setLoadingInitialData: (loading) =>
        set({ isLoadingInitialData: loading }),

      setFilters: (filters) =>
        set((state) => ({
          filters: { ...state.filters, ...filters },
        })),

      setDraggedTask: (taskId) => set({ draggedTask: taskId }),
      setDragOverColumn: (columnId) => set({ dragOverColumn: columnId }),
      setSelectedTask: (task) => set({ selectedTask: task }),
      setShowCreateModal: (show) => set({ showCreateModal: show }),
      setShowTaskModal: (show) => set({ showTaskModal: show }),

      setError: (type, error) =>
        set((state) => ({
          errors: { ...state.errors, [type]: error },
        })),

      // ==================== BULK DATA OPERATIONS ====================

      setInitialData: (data) => {
        set({
          tasks: data.tasks || [],
          projects: data.projects || [],
          teams: data.teams || [],
          users: data.users || [],
          errors: {
            tasks: data.errors?.tasks || null,
            projects: data.errors?.projects || null,
            teams: data.errors?.teams || null,
            users: data.errors?.users || null,
          },
        });
      },

      // ==================== TASK OPERATIONS ====================

      addTask: (task) =>
        set((state) => ({
          tasks: [...state.tasks, task],
        })),

      updateTask: (taskId, updates) =>
        set((state) => ({
          tasks: state.tasks.map((task) =>
            task.Id === taskId ? { ...task, ...updates } : task
          ),
        })),

      removeTask: (taskId) =>
        set((state) => ({
          tasks: state.tasks.filter((task) => task.Id !== taskId),
        })),

      updateTaskStatus: (taskId, newStatus) =>
        set((state) => ({
          tasks: state.tasks.map((task) =>
            task.Id === taskId ? { ...task, Status: newStatus } : task
          ),
        })),

      // Replace task if exists, otherwise add it
      upsertTask: (task) =>
        set((state) => {
          const existingIndex = state.tasks.findIndex((t) => t.Id === task.Id);
          if (existingIndex >= 0) {
            // Update existing task
            const updatedTasks = [...state.tasks];
            updatedTasks[existingIndex] = task;
            return { tasks: updatedTasks };
          } else {
            // Add new task
            return { tasks: [...state.tasks, task] };
          }
        }),

      // Refresh a single task from server
      refreshTask: async (apiClient, taskId) => {
        try {
          const response = await apiClient.post("/api/tasks/fetchTasks", {
            Id: taskId,
            PageNumber: 1,
            PageSize: 1,
            SearchTerm: null,
          });

          if (response.data.success && response.data.data.tasks.length > 0) {
            const updatedTask = response.data.data.tasks[0];
            get().upsertTask(updatedTask);
            return updatedTask;
          }
        } catch (error) {
          console.error("Error refreshing task:", error);
        }
        return null;
      },

      // ==================== UTILITY METHODS ====================

      // Get active columns sorted by order
      getActiveColumns: () => {
        const { kanbanColumns } = get();
        return kanbanColumns
          .filter((col) => col.isActive)
          .sort((a, b) => a.sortOrder - b.sortOrder);
      },

      // Get column by ID
      getColumnById: (columnId) => {
        const { kanbanColumns } = get();
        return kanbanColumns.find((col) => col.id === columnId);
      },

      // Get priority info by ID
      getPriorityById: (priorityId) => {
        const { priorities } = get();
        return priorities.find((p) => p.id === priorityId);
      },

      // Get task type info by ID
      getTaskTypeById: (typeId) => {
        const { taskTypes } = get();
        return taskTypes.find((t) => t.id === typeId);
      },

      // Get project by ID
      getProjectById: (projectId) => {
        const { projects } = get();
        return projects.find((p) => p.Id === projectId);
      },

      // Get team by ID
      getTeamById: (teamId) => {
        const { teams } = get();
        return teams.find((t) => t.Id === teamId);
      },

      // Get user by ID (any id-key variant)
      getUserById: (userId) => {
        const { users } = get();
        return findUserById(users, userId);
      },

      // ==================== FILTER METHODS ====================

      getFilteredTasks: (tasksData = null) => {
        const { tasks, filters } = get();
        const tasksToFilter = tasksData || tasks;

        // Remove duplicates first
        const uniqueTasks = tasksToFilter.reduce((acc, current) => {
          const existing = acc.find((task) => task.Id === current.Id);
          if (!existing) {
            acc.push(current);
          }
          return acc;
        }, []);

        // Apply filters
        return uniqueTasks.filter((task) => {
          const projectMatch =
            task.ProjectId === parseInt(filters.selectedProject);
          const teamMatch =
            filters.selectedTeam === "all" ||
            task.TeamId === parseInt(filters.selectedTeam);
          const priorityMatch =
            filters.selectedPriority === "all" ||
            (task.Priority || '').toLowerCase() === filters.selectedPriority;
          const assigneeMatch =
            filters.selectedAssignee === "all" ||
            task.AssignedToUserId === parseInt(filters.selectedAssignee);
          const searchMatch =
            filters.searchTerm === "" ||
            (task.Title || '').toLowerCase().includes(
              (filters.searchTerm || '').toLowerCase()
            ) ||
            (task.Description || '').toLowerCase().includes(
              (filters.searchTerm || '').toLowerCase()
            );

          return (
            projectMatch &&
            teamMatch &&
            priorityMatch &&
            assigneeMatch &&
            searchMatch
          );
        });
      },

      // Get tasks by column with filters applied
      getTasksByColumn: (columnId, tasksData = null) => {
        const filteredTasks = get().getFilteredTasks(tasksData);
        const columnTasks = filteredTasks.filter(
          (task) => task.Status === columnId
        );

        // Remove duplicates based on task ID
        return columnTasks.reduce((acc, current) => {
          const existing = acc.find((task) => task.Id === current.Id);
          if (!existing) {
            acc.push(current);
          }
          return acc;
        }, []);
      },

      // ==================== STATISTICS ====================

      getTaskStats: (tasksData = null) => {
        const filteredTasks = get().getFilteredTasks(tasksData);
        return {
          total: filteredTasks.length,
          inProgress: filteredTasks.filter(
            (task) => task.Status === "in-progress"
          ).length,
          high: filteredTasks.filter(
            (task) => (task.Priority || '').toLowerCase() === "high"
          ).length,
          done: filteredTasks.filter((task) => task.Status === "done").length,
          blocked: filteredTasks.filter((task) => task.IsBlocked).length,
        };
      },

      // ==================== VALIDATION METHODS ====================

      // Check if task can be moved to target column
      canMoveTaskToColumn: (taskId, targetColumnId) => {
        const { tasks } = get();
        const task = tasks.find((t) => t.Id === taskId);
        if (!task || task.Status === targetColumnId) return false;

        const targetColumn = get().getColumnById(targetColumnId);
        if (!targetColumn) return false;

        // Check capacity
        if (targetColumn.maxTasks) {
          const tasksInTargetColumn = get().getTasksByColumn(
            targetColumnId,
            null
          );
          if (tasksInTargetColumn.length >= targetColumn.maxTasks) {
            return false;
          }
        }

        // Check if transition is allowed
        const allowedTransitions = get().statusTransitions[task.Status] || [];
        return allowedTransitions.includes(targetColumnId);
      },

      // ==================== RESET METHODS ====================

      resetFilters: () =>
        set({
          filters: {
            selectedProject: "",
            selectedTeam: "all",
            selectedPriority: "all",
            selectedAssignee: "all",
            searchTerm: "",
            showFilters: false,
          },
        }),

      resetUIStates: () =>
        set({
          draggedTask: null,
          dragOverColumn: null,
          selectedTask: null,
          showCreateModal: false,
          showTaskModal: false,
        }),

      clearAllData: () =>
        set({
          tasks: [],
          projects: [],
          teams: [],
          users: [],
          errors: {
            tasks: null,
            projects: null,
            teams: null,
            users: null,
          },
        }),

      // ==================== UTILITY FUNCTIONS ====================

      // Parse JSON fields safely
      parseJsonField: (jsonString, fallback = []) => {
        try {
          if (!jsonString) return fallback;
          return typeof jsonString === "string"
            ? JSON.parse(jsonString)
            : jsonString;
        } catch {
          return fallback;
        }
      },

      // Get priority color
      getPriorityColor: (priority) => {
        switch ((priority || '').toLowerCase()) {
          case "high":
            return {
              backgroundColor: "#FF4444",
              color: "#FFFFFF",
              borderColor: "#FF6666",
            };
          case "medium":
            return {
              backgroundColor: "#FFB347",
              color: "#FFFFFF",
              borderColor: "#FFC266",
            };
          case "low":
            return {
              backgroundColor: "#32CD32",
              color: "#FFFFFF",
              borderColor: "#4AE54A",
            };
          default:
            return {
              backgroundColor: "#9CA3AF",
              color: "#FFFFFF",
              borderColor: "#D1D5DB",
            };
        }
      },

      // Format date
      formatDate: (date) => {
        if (!date) return "";
        try {
          return new Date(date).toLocaleDateString();
        } catch (error) {
          return "";
        }
      },

      // Get days until due
      getDaysUntilDue: (dueDate) => {
        if (!dueDate) return null;
        const today = new Date();
        const due = new Date(dueDate);
        const diffTime = due - today;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays;
      },

      // Create task object with defaults
      createTaskObject: (overrides = {}) => ({
        Id: 0,
        Title: "",
        Description: "",
        ProjectId: null,
        ParentTaskId: null,
        AssignedToUserId: null,
        TeamId: null,
        Priority: "medium",
        Type: "task",
        Status: "todo",
        DueDate: null,
        EstimatedHours: 0,
        LoggedHours: 0,
        Progress: 0,
        IsBlocked: false,
        Labels: "[]",
        Watchers: "[]",
        Dependencies: "[]",
        ...overrides,
      }),
    }),
    {
      name: "task-storage-eCRM", // unique name
      storage: createJSONStorage(() => localStorage),
      // Only persist certain parts
      partialize: (state) => ({
        filters: state.filters,
        // Don't persist tasks, projects, teams, users as they should be fresh from API
      }),
    }
  )
);

export default useTaskStore;
