import { LinearGradient } from "expo-linear-gradient";
import { useMemo, useState } from "react";
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import BottomSheetModal from "../components/BottomSheetModal";
import DateField from "../components/DateField";
import Dialog from "../components/Dialog";
import FAB from "../components/FAB";
import FieldRow from "../components/FieldRow";
import FormField from "../components/FormField";
import HeaderWithSearch from "../components/HeaderWithSearch";
import { DeleteIcon, EditIcon } from "../components/Icons";
import SelectField from "../components/SelectField";
import { theme } from "../constants/theme";
import {
  useCreateProject,
  useDeleteProject,
  useProjects,
  useUpdateProject,
} from "../hooks/useProjects";
import { useTeams } from "../hooks/useTeams";
import { useUsers } from "../hooks/useUsers";

// Status and Priority options from API docs
const PROJECT_STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "on_hold", label: "On Hold" },
  { value: "cancelled", label: "Cancelled" },
];

const PROJECT_PRIORITY_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const ProjectCard = ({ project, onEdit, onDelete }) => {
  const getStatusColor = (status) => {
    switch (status) {
      case "active":
        return theme.colors.status.success;
      case "completed":
        return theme.colors.primary.brand;
      case "on_hold":
        return theme.colors.status.warning;
      case "cancelled":
        return theme.colors.status.error;
      default:
        return theme.colors.gray[400];
    }
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case "low":
        return theme.colors.status.success;
      case "medium":
        return theme.colors.status.warning;
      case "high":
        return theme.colors.status.error;
      default:
        return theme.colors.gray[400];
    }
  };

  const formatCurrency = (amount) => {
    if (!amount) return "₹0";
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatDate = (dateString) => {
    if (!dateString) return "Not set";
    return new Date(dateString).toLocaleDateString("en-GB");
  };

  return (
    <View style={styles.projectCard}>
      <View style={styles.projectHeader}>
        <View style={styles.projectInfo}>
          <Text style={styles.projectName}>{project.Name}</Text>
          <Text style={styles.projectManager}>
            Manager: {project.ManagerName || "Not assigned"}
          </Text>
          <Text style={styles.projectTeam}>
            Team: {project.TeamName || "No team assigned"}
          </Text>
          {project.Description && (
            <Text style={styles.projectDescription} numberOfLines={2}>
              {project.Description}
            </Text>
          )}
        </View>
        <View style={styles.projectActions}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => onEdit(project)}
          >
            <EditIcon size={16} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.deleteBtn]}
            onPress={() => onDelete(project)}
          >
            <DeleteIcon size={16} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.projectStats}>
        <View style={styles.statRow}>
          <View style={styles.chipContainer}>
            <View
              style={[
                styles.statusBadge,
                { backgroundColor: getStatusColor(project.Status) },
              ]}
            >
              <Text style={styles.statusText}>{project.Status}</Text>
            </View>
          </View>
          <View style={styles.chipContainer}>
            <View
              style={[
                styles.priorityBadge,
                { backgroundColor: getPriorityColor(project.Priority) },
              ]}
            >
              <Text style={styles.priorityText}>{project.Priority}</Text>
            </View>
          </View>
        </View>

        <View style={styles.progressContainer}>
          <Text style={styles.progressLabel}>
            Progress: {project.Progress || 0}%
          </Text>
          <View style={styles.progressBar}>
            <View
              style={[
                styles.progressFill,
                { width: `${project.Progress || 0}%` },
              ]}
            />
          </View>
        </View>
      </View>

      <View style={styles.projectDetails}>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Budget:</Text>
          <Text style={styles.detailValue}>
            {formatCurrency(project.Budget)}
          </Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Tasks:</Text>
          <Text style={styles.detailValue}>{project.TaskCount || 0}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Timeline:</Text>
          <Text style={styles.detailValue}>
            {formatDate(project.StartDate)} - {formatDate(project.EndDate)}
          </Text>
        </View>
      </View>
    </View>
  );
};

const ProjectsScreen = ({ navigation }) => {
  const [searchText, setSearchText] = useState("");
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [selectedProject, setSelectedProject] = useState(null);
  const [formData, setFormData] = useState({
    Name: "",
    Description: "",
    ManagerUserId: null,
    TeamId: null,
    Status: "active",
    Priority: "medium",
    StartDate: null,
    EndDate: null,
    Budget: 0,
    Progress: 0,
  });
  const [formErrors, setFormErrors] = useState({});
  const [dialogState, setDialogState] = useState({
    visible: false,
    type: "info",
    title: "",
    message: "",
    onConfirm: null,
    showCancel: false,
  });

  // React Query hooks
  const {
    data: projects = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useProjects(searchText);

  const { data: users = [], isLoading: isLoadingUsers } = useUsers();

  const { data: teams = [], isLoading: isLoadingTeams } = useTeams();

  const createProjectMutation = useCreateProject();
  const updateProjectMutation = useUpdateProject();
  const deleteProjectMutation = useDeleteProject();

  // Filter users to only show Project Managers (GroupId === 3)
  const projectManagers = useMemo(() => {
    return users.filter((user) => user.GroupId === 3);
  }, [users]);

  // Filter projects using useMemo
  const filteredProjects = useMemo(() => {
    if (!searchText) {
      return projects;
    }

    return projects.filter(
      (project) =>
        project.Name?.toLowerCase().includes(searchText.toLowerCase()) ||
        project.Description?.toLowerCase().includes(searchText.toLowerCase()) ||
        project.ManagerName?.toLowerCase().includes(searchText.toLowerCase()) ||
        project.TeamName?.toLowerCase().includes(searchText.toLowerCase())
    );
  }, [searchText, projects]);

  const onRefresh = () => {
    refetch();
  };

  const validateForm = () => {
    const errors = {};

    if (!formData.Name.trim()) {
      errors.Name = "Project name is required";
    }

    if (!formData.ManagerUserId) {
      errors.ManagerUserId = "Project manager is required";
    }

    if (!formData.Status) {
      errors.Status = "Status is required";
    }

    if (!formData.Priority) {
      errors.Priority = "Priority is required";
    }

    if (formData.Budget && formData.Budget < 0) {
      errors.Budget = "Budget must be 0 or greater";
    }

    if (
      formData.Progress &&
      (formData.Progress < 0 || formData.Progress > 100)
    ) {
      errors.Progress = "Progress must be between 0 and 100";
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleAddProject = () => {
    setSelectedProject(null);
    setFormData({
      Name: "",
      Description: "",
      ManagerUserId:
        projectManagers.length > 0 ? projectManagers[0].userid : null,
      TeamId: teams.length > 0 ? teams[0].Id : null,
      Status: "active",
      Priority: "medium",
      StartDate: null,
      EndDate: null,
      Budget: 0,
      Progress: 0,
    });
    setFormErrors({});
    setIsModalVisible(true);
  };

  const handleEditProject = (project) => {
    setSelectedProject(project);
    setFormData({
      Name: project.Name,
      Description: project.Description || "",
      ManagerUserId: project.ManagerUserId,
      TeamId: project.TeamId,
      Status: project.Status,
      Priority: project.Priority,
      StartDate: project.StartDate,
      EndDate: project.EndDate,
      Budget: project.Budget || 0,
      Progress: project.Progress || 0,
    });
    setFormErrors({});
    setIsModalVisible(true);
  };

  const handleSaveProject = async () => {
    if (!validateForm()) return;

    try {
      const projectData = {
        Id: selectedProject ? selectedProject.Id : 0,
        Name: formData.Name,
        Description: formData.Description,
        ManagerUserId: formData.ManagerUserId,
        TeamId: formData.TeamId,
        Members: selectedProject ? selectedProject.Members : "[]",
        Status: formData.Status,
        Priority: formData.Priority,
        StartDate: formData.StartDate
          ? new Date(formData.StartDate).toISOString().split("T")[0]
          : null,
        EndDate: formData.EndDate
          ? new Date(formData.EndDate).toISOString().split("T")[0]
          : null,
        Budget: parseFloat(formData.Budget) || 0,
        Progress: parseInt(formData.Progress) || 0,
        BranchId: 1,
        CompId: 1,
      };

      if (selectedProject) {
        await updateProjectMutation.mutateAsync(projectData);
        setDialogState({
          visible: true,
          type: "success",
          title: "Success",
          message: "Project updated successfully",
          onConfirm: null,
          showCancel: false,
        });
      } else {
        await createProjectMutation.mutateAsync(projectData);
        setDialogState({
          visible: true,
          type: "success",
          title: "Success",
          message: "Project created successfully",
          onConfirm: null,
          showCancel: false,
        });
      }

      setIsModalVisible(false);
    } catch (error) {
      console.error("Error saving project:", error);

      const errorMessage =
        error?.response?.data?.message ||
        error?.message ||
        "Failed to save project";
      const errorCode = error?.response?.data?.responseCode;
      const displayMessage = errorCode
        ? `${errorMessage} (Code: ${errorCode})`
        : errorMessage;

      setDialogState({
        visible: true,
        type: "error",
        title: "Error",
        message: displayMessage,
        onConfirm: null,
        showCancel: false,
      });
    }
  };

  const handleDeleteProject = (project) => {
    setDialogState({
      visible: true,
      type: "warning",
      title: "Delete Project",
      message: `Are you sure you want to delete "${project.Name}"? This action cannot be undone.`,
      confirmText: "Delete",
      cancelText: "Cancel",
      showCancel: true,
      onConfirm: async () => {
        try {
          await deleteProjectMutation.mutateAsync(project.Id);

          setDialogState({
            visible: true,
            type: "success",
            title: "Success",
            message: "Project deleted successfully",
            onConfirm: null,
            showCancel: false,
          });
        } catch (error) {
          console.error("Error deleting project:", error);

          const errorMessage =
            error?.response?.data?.message ||
            error?.message ||
            "Failed to delete project";
          const errorCode = error?.response?.data?.responseCode;
          const displayMessage = errorCode
            ? `${errorMessage} (Code: ${errorCode})`
            : errorMessage;

          setDialogState({
            visible: true,
            type: "error",
            title: "Error",
            message: displayMessage,
            onConfirm: null,
            showCancel: false,
          });
        }
      },
    });
  };

  const closeModal = () => {
    setIsModalVisible(false);
    setSelectedProject(null);
    setFormData({
      Name: "",
      Description: "",
      ManagerUserId: null,
      TeamId: null,
      Status: "active",
      Priority: "medium",
      StartDate: null,
      EndDate: null,
      Budget: 0,
      Progress: 0,
    });
    setFormErrors({});
  };

  // Show error state
  if (isError) {
    return (
      <View style={styles.container}>
        <HeaderWithSearch
          title="Projects"
          navigation={navigation}
          searchText={searchText}
          setSearchText={setSearchText}
          searchPlaceholder="Search projects, managers, descriptions..."
        />
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>
            Error loading projects: {error?.message}
          </Text>
          <TouchableOpacity style={styles.btnSave} onPress={() => refetch()}>
            <LinearGradient
              colors={["#5A6BC0", "#3F4FAF"]}
              style={styles.btnSaveGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <Text style={styles.btnSaveText}>Retry</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (isLoading && projects.length === 0) {
    return (
      <View style={styles.container}>
        <HeaderWithSearch
          title="Projects"
          navigation={navigation}
          searchText={searchText}
          setSearchText={setSearchText}
          searchPlaceholder="Search projects, managers, descriptions..."
        />
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading projects...</Text>
        </View>
      </View>
    );
  }

  const activeProjectsCount = projects.filter(
    (project) => project.Status === "active"
  ).length;
  const totalBudget = projects.reduce(
    (sum, project) => sum + (project.Budget || 0),
    0
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <HeaderWithSearch
        title="Projects"
        navigation={navigation}
        searchText={searchText}
        setSearchText={setSearchText}
        searchPlaceholder="Search projects, managers, descriptions..."
        statsData={{
          totalUsers: projects.length,
          activeUsers: activeProjectsCount,
          totalGroups: Math.round(totalBudget / 100000),
          labels: {
            total: "Total Projects",
            active: "Active Projects",
            groups: "Budget (Lakhs)",
          },
        }}
      />

      {/* Projects List */}
      <FlatList
        data={filteredProjects}
        renderItem={({ item }) => (
          <ProjectCard
            project={item}
            onEdit={handleEditProject}
            onDelete={handleDeleteProject}
          />
        )}
        keyExtractor={(item) => item.Id.toString()}
        style={styles.projectsList}
        contentContainerStyle={styles.projectsListContent}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No projects found</Text>
          </View>
        }
      />

      {/* FAB */}
      <FAB onPress={handleAddProject} />

      {/* Bottom Sheet Modal */}
      <BottomSheetModal
        visible={isModalVisible}
        onClose={closeModal}
        title={selectedProject ? "Edit Project" : "Add New Project"}
      >
        {/* Row 1: Project Name */}
        <FormField
          label="Project Name"
          value={formData.Name}
          onChangeText={(text) => setFormData({ ...formData, Name: text })}
          error={formErrors.Name}
        />

        {/* Row 2: Project Manager */}
        <SelectField
          label="Project Manager"
          value={formData.ManagerUserId}
          onSelect={(value) =>
            setFormData({ ...formData, ManagerUserId: value })
          }
          options={projectManagers.map((user) => ({
            value: user.userid,
            label: `${user.FullName} - ${user.JobTitle || "Project Manager"}`,
          }))}
          error={formErrors.ManagerUserId}
        />

        {/* Row 3: Team */}
        <SelectField
          label="Team"
          value={formData.TeamId}
          onSelect={(value) => setFormData({ ...formData, TeamId: value })}
          options={teams.map((team) => ({ value: team.Id, label: team.Name }))}
          error={formErrors.TeamId}
        />

        {/* Row 4: Status & Priority */}
        <FieldRow>
          <SelectField
            label="Status"
            value={formData.Status}
            onSelect={(value) => setFormData({ ...formData, Status: value })}
            options={PROJECT_STATUS_OPTIONS}
            error={formErrors.Status}
          />

          <SelectField
            label="Priority"
            value={formData.Priority}
            onSelect={(value) => setFormData({ ...formData, Priority: value })}
            options={PROJECT_PRIORITY_OPTIONS}
            error={formErrors.Priority}
          />
        </FieldRow>

        {/* Row 5: Description */}
        <FormField
          label="Project Description"
          value={formData.Description}
          onChangeText={(text) =>
            setFormData({ ...formData, Description: text })
          }
          multiline={true}
          numberOfLines={4}
          error={formErrors.Description}
        />

        {/* Row 6: Dates */}
        <FieldRow>
          <DateField
            label="Start Date"
            value={formData.StartDate}
            onChange={(date) => setFormData({ ...formData, StartDate: date })}
            format="YYYY-MM-DD"
            error={formErrors.StartDate}
          />

          <DateField
            label="End Date"
            value={formData.EndDate}
            onChange={(date) => setFormData({ ...formData, EndDate: date })}
            format="YYYY-MM-DD"
            error={formErrors.EndDate}
            defaultToToday={false}
          />
        </FieldRow>

        {/* Row 7: Budget & Progress */}
        <FieldRow>
          <FormField
            label="Budget (INR)"
            value={formData.Budget.toString()}
            onChangeText={(text) =>
              setFormData({ ...formData, Budget: parseFloat(text) || 0 })
            }
            keyboardType="numeric"
            error={formErrors.Budget}
          />

          <FormField
            label="Progress (%)"
            value={formData.Progress.toString()}
            onChangeText={(text) =>
              setFormData({ ...formData, Progress: parseInt(text) || 0 })
            }
            keyboardType="numeric"
            error={formErrors.Progress}
          />
        </FieldRow>

        <View style={styles.modalActions}>
          <TouchableOpacity style={styles.btnCancel} onPress={closeModal}>
            <Text style={styles.btnCancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.btnSave}
            onPress={handleSaveProject}
            disabled={
              createProjectMutation.isPending || updateProjectMutation.isPending
            }
          >
            <LinearGradient
              colors={[
                theme.colors.primary.secondaryLight,
                theme.colors.primary.secondary,
              ]}
              style={styles.btnSaveGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <Text style={styles.btnSaveText}>
                {createProjectMutation.isPending ||
                updateProjectMutation.isPending
                  ? selectedProject
                    ? "Updating..."
                    : "Saving..."
                  : selectedProject
                  ? "Update Project"
                  : "Save Project"}
              </Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </BottomSheetModal>

      {/* Dialog */}
      <Dialog
        visible={dialogState.visible}
        type={dialogState.type}
        title={dialogState.title}
        message={dialogState.message}
        confirmText={dialogState.confirmText}
        cancelText={dialogState.cancelText}
        showCancel={dialogState.showCancel}
        onConfirm={dialogState.onConfirm}
        onClose={() => setDialogState({ ...dialogState, visible: false })}
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
  // Projects List
  projectsList: {
    flex: 1,
    paddingBottom: 80, // Account for FAB
  },
  projectsListContent: {
    padding: 15,
    paddingBottom: 100,
  },
  // Project Card
  projectCard: {
    backgroundColor: theme.colors.white,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: theme.colors.gray[100],
  },
  projectHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  projectInfo: {
    flex: 1,
    minWidth: 0,
  },
  projectName: {
    fontSize: 16,
    fontWeight: theme.typography.fontWeights.bold,
    color: theme.colors.gray[800],
    marginBottom: 4,
  },
  projectManager: {
    fontSize: 12,
    color: theme.colors.primary.brand,
    fontWeight: theme.typography.fontWeights.normal,
    marginBottom: 2,
  },
  projectTeam: {
    fontSize: 12,
    color: theme.colors.gray[600],
    marginBottom: 4,
  },
  projectDescription: {
    fontSize: 12,
    color: theme.colors.gray[500],
    lineHeight: 16,
  },
  projectActions: {
    flexDirection: "row",
    gap: 6,
    flexShrink: 0,
    marginLeft: 8,
  },
  actionBtn: {
    width: 28,
    height: 28,
    backgroundColor: theme.colors.gray[100],
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  deleteBtn: {
    backgroundColor: theme.colors.status.error + "10",
  },
  projectStats: {
    marginBottom: 12,
  },
  statRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
  },
  chipContainer: {
    borderRadius: 12,
    padding: 2,
    backgroundColor: theme.colors.white,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 1,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  statusText: {
    fontSize: 10,
    fontWeight: theme.typography.fontWeights.normal,
    color: theme.colors.white,
    textTransform: "capitalize",
  },
  priorityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  priorityText: {
    fontSize: 10,
    fontWeight: theme.typography.fontWeights.normal,
    color: theme.colors.white,
    textTransform: "capitalize",
  },
  progressContainer: {
    marginTop: 4,
  },
  progressLabel: {
    fontSize: 11,
    color: theme.colors.gray[600],
    marginBottom: 4,
  },
  progressBar: {
    height: 6,
    backgroundColor: theme.colors.gray[200],
    borderRadius: 3,
  },
  progressFill: {
    height: "100%",
    backgroundColor: theme.colors.primary.brand,
    borderRadius: 3,
  },
  projectDetails: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.gray[100],
    paddingTop: 12,
    gap: 4,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  detailLabel: {
    fontSize: 11,
    color: theme.colors.gray[500],
  },
  detailValue: {
    fontSize: 11,
    color: theme.colors.gray[700],
    fontWeight: theme.typography.fontWeights.normal,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: 100,
  },
  emptyText: {
    fontSize: theme.typography.fontSizes.base,
    color: theme.colors.gray[500],
    textAlign: "center",
  },
  // Modal Actions
  modalActions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 24,
  },
  btnCancel: {
    flex: 1,
    padding: 14,
    backgroundColor: theme.colors.gray[100],
    borderRadius: 12,
    alignItems: "center",
  },
  btnCancelText: {
    fontSize: 14,
    fontWeight: theme.typography.fontWeights.semibold,
    color: theme.colors.gray[600],
  },
  btnSave: {
    flex: 1,
    borderRadius: 12,
    shadowColor: theme.colors.primary.secondary,
    shadowOffset: {
      width: 0,
      height: 8,
    },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 8,
  },
  btnSaveGradient: {
    padding: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  btnSaveText: {
    fontSize: 14,
    fontWeight: theme.typography.fontWeights.semibold,
    color: theme.colors.white,
  },
});

export default ProjectsScreen;
