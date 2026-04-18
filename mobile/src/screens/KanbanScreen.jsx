import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useMemo, useState } from "react";
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import BottomSheetModal from "../components/BottomSheetModal";
import Dialog from "../components/Dialog";
import FAB from "../components/FAB";
import FieldRow from "../components/FieldRow";
import FormField from "../components/FormField";
import HeaderWithSearch from "../components/HeaderWithSearch";
import HeaderFilters from "../components/HeaderFilters";
import { DeleteIcon, EditIcon, WorkIcon } from "../components/Icons";
import SelectField from "../components/SelectField";
import { theme } from "../constants/theme";
import {
  useCreateKanbanColumn,
  useDeleteKanbanColumn,
  useKanbanColumns,
  useUpdateKanbanColumn,
} from "../hooks/useKanban";
import { useProjects } from "../hooks/useProjects";

// Predefined color palette from API docs
const KANBAN_COLORS = [
  { value: "#3B82F6", label: "Soft Blue", color: "#3B82F6" },
  { value: "#fb6f92", label: "Soft Pink", color: "#fb6f92" },
  { value: "#b388eb", label: "Soft Purple", color: "#b388eb" },
  { value: "#4ADE80", label: "Soft Green", color: "#4ADE80" },
  { value: "#FB923C", label: "Soft Orange", color: "#FB923C" },
  { value: "#EF4444", label: "Soft Red", color: "#EF4444" },
  { value: "#06B6D4", label: "Soft Teal", color: "#06B6D4" },
  { value: "#f7aef8", label: "Soft Lavender", color: "#f7aef8" },
  { value: "#8093f1", label: "Soft Indigo", color: "#8093f1" },
  { value: "#9381ff", label: "Soft Violet", color: "#9381ff" },
  { value: "#7fd8be", label: "Soft Mint", color: "#7fd8be" },
  { value: "#64748B", label: "Soft Slate", color: "#64748B" },
];

const ColumnCard = ({ column, onEdit, onDelete }) => {
  return (
    <View style={[styles.columnCard, { borderLeftColor: column.Color }]}>
      <View style={styles.columnHeader}>
        <View style={styles.columnInfo}>
          <View
            style={[styles.colorPreview, { backgroundColor: column.Color }]}
          />
          <View style={styles.columnDetails}>
            <Text style={styles.columnTitle}>{column.Title}</Text>
            <Text style={styles.columnId}>ID: {column.Id}</Text>
            <Text style={styles.columnOrder}>Order: {column.SortOrder}</Text>
          </View>
        </View>
        <View style={styles.columnActions}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => onEdit(column)}
          >
            <EditIcon size={16} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.deleteBtn]}
            onPress={() => onDelete(column)}
          >
            <DeleteIcon size={16} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.columnStats}>
        <View style={styles.statItem}>
          <Text style={styles.statNumber}>{column.TaskCount || 0}</Text>
          <Text style={styles.statLabel}>Tasks</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statNumber}>{column.MaxTasks || "∞"}</Text>
          <Text style={styles.statLabel}>Max Tasks</Text>
        </View>
        <View style={styles.statItem}>
          <Text
            style={[
              styles.statNumber,
              {
                color: column.IsActive
                  ? theme.colors.status.success
                  : theme.colors.gray[400],
              },
            ]}
          >
            {column.IsActive ? "Active" : "Inactive"}
          </Text>
          <Text style={styles.statLabel}>Status</Text>
        </View>
      </View>
    </View>
  );
};

const KanbanScreen = ({ navigation }) => {
  const [searchText, setSearchText] = useState("");
  const [selectedProject, setSelectedProject] = useState(null);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [selectedColumn, setSelectedColumn] = useState(null);
  const [formData, setFormData] = useState({
    Title: "",
    Color: "#3B82F6",
    SortOrder: 1,
    MaxTasks: null,
    IsActive: true,
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
  const { data: projects = [], isLoading: projectsLoading } = useProjects();
  const {
    data: columns = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useKanbanColumns(selectedProject);

  const createColumnMutation = useCreateKanbanColumn();
  const updateColumnMutation = useUpdateKanbanColumn();
  const deleteColumnMutation = useDeleteKanbanColumn();

  // Set default project to first project when projects load
  useEffect(() => {
    if (projects.length > 0 && selectedProject === null) {
      setSelectedProject(projects[0].Id);
    }
  }, [projects, selectedProject]);

  // Filter columns using useMemo
  const filteredColumns = useMemo(() => {
    if (!searchText) {
      return columns.sort((a, b) => a.SortOrder - b.SortOrder);
    }

    return columns
      .filter(
        (column) =>
          column.Title?.toLowerCase().includes(searchText.toLowerCase()) ||
          column.Id?.toLowerCase().includes(searchText.toLowerCase())
      )
      .sort((a, b) => a.SortOrder - b.SortOrder);
  }, [searchText, columns]);

  const onRefresh = () => {
    refetch();
  };

  const validateForm = () => {
    const errors = {};

    if (!formData.Title.trim()) {
      errors.Title = "Column title is required";
    }

    if (!formData.Color) {
      errors.Color = "Column color is required";
    }

    if (!formData.SortOrder || formData.SortOrder < 1) {
      errors.SortOrder = "Sort order must be 1 or greater";
    }

    if (formData.MaxTasks && formData.MaxTasks < 1) {
      errors.MaxTasks = "Max tasks must be 1 or greater";
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleAddColumn = () => {
    if (!selectedProject) {
      setDialogState({
        visible: true,
        type: "warning",
        title: "No Project Selected",
        message: "Please select a project first before adding columns.",
        onConfirm: null,
        showCancel: false,
      });
      return;
    }

    setSelectedColumn(null);
    setFormData({
      Title: "",
      Color: "#3B82F6",
      SortOrder: columns.length + 1,
      MaxTasks: null,
      IsActive: true,
    });
    setFormErrors({});
    setIsModalVisible(true);
  };


  const handleEditColumn = (column) => {
    setSelectedColumn(column);
    setFormData({
      Title: column.Title,
      Color: column.Color,
      SortOrder: column.SortOrder,
      MaxTasks: column.MaxTasks,
      IsActive: column.IsActive,
    });
    setFormErrors({});
    setIsModalVisible(true);
  };

  const handleSaveColumn = async () => {
    if (!validateForm()) return;

    try {
      const columnData = {
        Id: selectedColumn ? selectedColumn.Id : 0, // Use 0 for new columns, existing ID for updates
        ProjectId: selectedProject, // Required - Project ID
        Title: formData.Title,
        Color: formData.Color,
        SortOrder: parseInt(formData.SortOrder),
        MaxTasks: formData.MaxTasks ? parseInt(formData.MaxTasks) : null,
        IsActive: formData.IsActive,
      };

      if (selectedColumn) {
        await updateColumnMutation.mutateAsync(columnData);
        setDialogState({
          visible: true,
          type: "success",
          title: "Success",
          message: "Column updated successfully",
          onConfirm: null,
          showCancel: false,
        });
      } else {
        await createColumnMutation.mutateAsync(columnData);
        setDialogState({
          visible: true,
          type: "success",
          title: "Success",
          message: "Column created successfully",
          onConfirm: null,
          showCancel: false,
        });
      }

      setIsModalVisible(false);
    } catch (error) {
      console.error("Error saving column:", error);

      const errorMessage =
        error?.response?.data?.message ||
        error?.message ||
        "Failed to save column";
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

  const handleDeleteColumn = (column) => {
    setDialogState({
      visible: true,
      type: "warning",
      title: "Delete Column",
      message: `Are you sure you want to delete "${column.Title}"? This action cannot be undone.`,
      confirmText: "Delete",
      cancelText: "Cancel",
      showCancel: true,
      onConfirm: async () => {
        try {
          await deleteColumnMutation.mutateAsync(column.Id);

          setDialogState({
            visible: true,
            type: "success",
            title: "Success",
            message: "Column deleted successfully",
            onConfirm: null,
            showCancel: false,
          });
        } catch (error) {
          console.error("Error deleting column:", error);

          const errorMessage =
            error?.response?.data?.message ||
            error?.message ||
            "Failed to delete column";
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
    setSelectedColumn(null);
    setFormData({
      Title: "",
      Color: "#3B82F6",
      SortOrder: 1,
      MaxTasks: null,
      IsActive: true,
    });
    setFormErrors({});
  };


  // Filter configuration for HeaderWithSearch
  const filterConfig = {
    renderFilters: () => {
      return (
        <HeaderFilters
          selectedProject={selectedProject}
          onProjectChange={setSelectedProject}
          projects={projects}
          hideStatusFilter={true}
        />
      );
    },
  };

  // Show error state
  if (isError) {
    return (
      <View style={styles.container}>
        <HeaderWithSearch
          title="Kanban Columns"
          navigation={navigation}
          searchText={searchText}
          setSearchText={setSearchText}
          searchPlaceholder="Search columns by title or ID..."
          showFilters={true}
          filterConfig={filterConfig}
        />
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>
            Error loading columns: {error?.message}
          </Text>
          <TouchableOpacity style={styles.btnSave} onPress={() => refetch()}>
            <LinearGradient
              colors={[
                theme.colors.primary.secondaryLight,
                theme.colors.primary.secondary,
              ]}
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

  if (isLoading && columns.length === 0) {
    return (
      <View style={styles.container}>
        <HeaderWithSearch
          title="Kanban Columns"
          navigation={navigation}
          searchText={searchText}
          setSearchText={setSearchText}
          searchPlaceholder="Search columns by title or ID..."
          showFilters={true}
          filterConfig={filterConfig}
        />
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading columns...</Text>
        </View>
      </View>
    );
  }

  const activeColumnsCount = columns.filter(
    (column) => column.IsActive === true
  ).length;
  const totalTasks = columns.reduce(
    (sum, column) => sum + (column.TaskCount || 0),
    0
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <HeaderWithSearch
        title="Kanban Columns"
        navigation={navigation}
        searchText={searchText}
        setSearchText={setSearchText}
        searchPlaceholder="Search columns by title or ID..."
        showFilters={true}
        filterConfig={filterConfig}
        statsData={{
          totalUsers: columns.length,
          activeUsers: activeColumnsCount,
          totalGroups: totalTasks,
          labels: {
            total: "Total Columns",
            active: "Active Columns",
            groups: "Total Tasks",
          },
        }}
      />

      {/* Columns List */}
      <FlatList
        data={filteredColumns}
        renderItem={({ item }) => (
          <ColumnCard
            column={item}
            onEdit={handleEditColumn}
            onDelete={handleDeleteColumn}
          />
        )}
        keyExtractor={(item) => item.Id}
        style={styles.columnsList}
        contentContainerStyle={styles.columnsListContent}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No columns found</Text>
          </View>
        }
      />

      {/* FAB */}
      <FAB onPress={handleAddColumn} />

      {/* Bottom Sheet Modal */}
      <BottomSheetModal
        visible={isModalVisible}
        onClose={closeModal}
        title={selectedColumn ? "Edit Column" : "Add New Column"}
      >
        {/* Row 1: Column Title only */}
        <FormField
          label="Column Title"
          value={formData.Title}
          onChangeText={(text) => {
            setFormData({ ...formData, Title: text });
          }}
          icon={<WorkIcon />}
          error={formErrors.Title}
        />

        {/* Row 2: Column Color & Status */}
        <FieldRow>
          <SelectField
            label="Column Color"
            value={formData.Color}
            onSelect={(value) => setFormData({ ...formData, Color: value })}
            options={KANBAN_COLORS}
            icon={
              <View
                style={[styles.colorIcon, { backgroundColor: formData.Color }]}
              />
            }
            error={formErrors.Color}
            renderOption={(item) => (
              <View style={styles.colorOption}>
                <View
                  style={[styles.colorCircle, { backgroundColor: item.color }]}
                />
                <Text style={styles.colorLabel}>{item.label}</Text>
              </View>
            )}
          />

          <SelectField
            label="Status"
            value={formData.IsActive}
            onSelect={(value) => setFormData({ ...formData, IsActive: value })}
            options={[
              { value: true, label: "Active" },
              { value: false, label: "Inactive" },
            ]}
            icon={
              <View
                style={[
                  styles.statusIcon,
                  {
                    backgroundColor: formData.IsActive
                      ? theme.colors.status.success
                      : theme.colors.gray[400],
                  },
                ]}
              />
            }
            error={formErrors.IsActive}
          />
        </FieldRow>

        {/* Row 3: Sort Order & Max Tasks */}
        <FieldRow>
          <FormField
            label="Sort Order"
            value={formData.SortOrder.toString()}
            onChangeText={(text) =>
              setFormData({ ...formData, SortOrder: parseInt(text) || 1 })
            }
            icon={<WorkIcon />}
            keyboardType="numeric"
            error={formErrors.SortOrder}
          />

          <FormField
            label="Max Tasks"
            value={formData.MaxTasks?.toString() || ""}
            onChangeText={(text) =>
              setFormData({
                ...formData,
                MaxTasks: text ? parseInt(text) : null,
              })
            }
            icon={<WorkIcon />}
            keyboardType="numeric"
            error={formErrors.MaxTasks}
          />
        </FieldRow>

        <View style={styles.modalActions}>
          <TouchableOpacity style={styles.btnCancel} onPress={closeModal}>
            <Text style={styles.btnCancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.btnSave}
            onPress={handleSaveColumn}
            disabled={
              createColumnMutation.isPending || updateColumnMutation.isPending
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
                {createColumnMutation.isPending ||
                updateColumnMutation.isPending
                  ? selectedColumn
                    ? "Updating..."
                    : "Saving..."
                  : selectedColumn
                  ? "Update Column"
                  : "Save Column"}
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
  // Columns List
  columnsList: {
    flex: 1,
    paddingBottom: 80, // Account for FAB
  },
  columnsListContent: {
    padding: 15,
    paddingBottom: 100,
  },
  // Column Card
  columnCard: {
    backgroundColor: theme.colors.white,
    borderRadius: 14,
    borderLeftWidth: 4,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: theme.colors.gray[100],
  },
  columnHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  columnInfo: {
    flexDirection: "row",
    flex: 1,
    gap: 12,
    minWidth: 0,
  },
  colorPreview: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 3,
    borderColor: theme.colors.white,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  columnDetails: {
    flex: 1,
    minWidth: 0,
  },
  columnTitle: {
    fontSize: 16,
    fontWeight: theme.typography.fontWeights.bold,
    color: theme.colors.gray[800],
    marginBottom: 4,
  },
  columnId: {
    fontSize: 12,
    color: theme.colors.primary.brand,
    fontWeight: theme.typography.fontWeights.normal,
    marginBottom: 2,
  },
  columnOrder: {
    fontSize: 12,
    color: theme.colors.gray[500],
  },
  columnActions: {
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
  columnStats: {
    flexDirection: "row",
    gap: 20,
  },
  statItem: {
    alignItems: "center",
  },
  statNumber: {
    fontSize: 16,
    fontWeight: theme.typography.fontWeights.bold,
    color: theme.colors.gray[800],
  },
  statLabel: {
    fontSize: 10,
    color: theme.colors.gray[500],
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
  colorIcon: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.gray[300],
  },
  statusIcon: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  colorOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  colorCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.gray[200],
  },
  colorLabel: {
    fontSize: 14,
    color: theme.colors.gray[800],
  },
});

export default KanbanScreen;
