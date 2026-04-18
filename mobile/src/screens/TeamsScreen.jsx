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
import Dialog from "../components/Dialog";
import FAB from "../components/FAB";
import FieldRow from "../components/FieldRow";
import FormField from "../components/FormField";
import HeaderWithSearch from "../components/HeaderWithSearch";
import {
  DeleteIcon,
  EditIcon,
  GroupIcon,
  UserIcon,
  WorkIcon,
} from "../components/Icons";
import MultiSelectField from "../components/MultiSelectField";
import SelectField from "../components/SelectField";
import { theme } from "../constants/theme";
import {
  useCreateTeam,
  useDeleteTeam,
  useTeams,
  useUpdateTeam,
} from "../hooks/useTeams";
import { useUsers } from "../hooks/useUsers";

const TeamCard = ({ team, onEdit, onDelete }) => {
  return (
    <View style={styles.teamCard}>
      <View style={styles.teamHeader}>
        <View style={styles.teamTopRow}>
          <View style={styles.avatarContainer}>
            <View
              style={[
                styles.teamAvatar,
                { backgroundColor: team.Color || "#3B82F6" },
              ]}
            >
              <Text style={styles.teamInitials}>
                {team.Name.substring(0, 2).toUpperCase()}
              </Text>
            </View>
          </View>
          <View style={styles.chipContainer}>
            <View
              style={[
                styles.statusChip,
                {
                  backgroundColor: team.IsActive
                    ? theme.colors.status.success
                    : theme.colors.gray[400],
                },
              ]}
            >
              <Text style={styles.statusText}>
                {team.IsActive ? "Active" : "Inactive"}
              </Text>
            </View>
          </View>
        </View>
        <View style={styles.teamActions}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => onEdit(team)}
          >
            <EditIcon size={16} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.deleteBtn]}
            onPress={() => onDelete(team)}
          >
            <DeleteIcon size={16} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.teamInfo}>
        <Text style={styles.teamName} numberOfLines={1} ellipsizeMode="tail">
          {team.Name}
        </Text>
        <Text style={styles.teamManager} numberOfLines={1} ellipsizeMode="tail">
          Lead: {team.LeadName || team.ManagerName || "No lead assigned"}
        </Text>
        <Text
          style={styles.teamDescription}
          numberOfLines={2}
          ellipsizeMode="tail"
        >
          {team.Description}
        </Text>
      </View>

      {/* Team Members */}
      {team.Members && team.Members.length > 0 && (
        <View style={styles.teamMembers}>
          <Text style={styles.membersTitle}>Team Members:</Text>
          <View style={styles.membersChipsContainer}>
            {team.Members.slice(0, 6).map((member, index) => (
              <View
                key={member.UserId || member.userid || index}
                style={styles.chipContainer}
              >
                <View
                  style={[
                    styles.memberChip,
                    { backgroundColor: team.Color || "#3B82F6" },
                  ]}
                >
                  <Text style={styles.memberChipText}>{member.FullName}</Text>
                </View>
              </View>
            ))}
            {team.Members.length > 6 && (
              <View style={styles.chipContainer}>
                <View style={[styles.memberChip, styles.moreChip]}>
                  <Text style={styles.moreChipText}>
                    +{team.Members.length - 6} more
                  </Text>
                </View>
              </View>
            )}
          </View>
        </View>
      )}
    </View>
  );
};

const TeamsScreen = ({ navigation }) => {
  const [searchText, setSearchText] = useState("");
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [formData, setFormData] = useState({
    Name: "",
    Description: "",
    LeadUserId: null,
    Color: "#3B82F6",
    Members: [],
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
  const {
    data: teams = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useTeams(searchText);

  const { data: users = [], isLoading: isLoadingUsers } = useUsers();

  const createTeamMutation = useCreateTeam();
  const updateTeamMutation = useUpdateTeam();
  const deleteTeamMutation = useDeleteTeam();

  // Filter teams using useMemo to prevent infinite re-renders
  const filteredTeams = useMemo(() => {
    if (!searchText) {
      return teams;
    }

    return teams.filter(
      (team) =>
        team.Name?.toLowerCase().includes(searchText.toLowerCase()) ||
        team.Description?.toLowerCase().includes(searchText.toLowerCase()) ||
        team.LeadName?.toLowerCase().includes(searchText.toLowerCase()) ||
        team.ManagerName?.toLowerCase().includes(searchText.toLowerCase())
    );
  }, [searchText, teams]);

  const onRefresh = () => {
    refetch();
  };

  const validateForm = () => {
    const errors = {};

    if (!formData.Name.trim()) {
      errors.Name = "Team name is required";
    } else if (formData.Name.length > 100) {
      errors.Name = "Team name must be less than 100 characters";
    }

    if (!formData.Color) {
      errors.Color = "Team color is required";
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleAddTeam = () => {
    setSelectedTeam(null);
    setFormData({
      Name: "",
      Description: "",
      LeadUserId: null,
      Color: "#3B82F6",
      Members: [],
      IsActive: true,
    });
    setFormErrors({});
    setIsModalVisible(true);
  };

  const handleEditTeam = (team) => {
    setSelectedTeam(team);
    setFormData({
      Name: team.Name,
      Description: team.Description || "",
      LeadUserId: team.LeadUserId || team.ManagerId,
      Color: team.Color || "#3B82F6",
      Members: team.Members ? team.Members.map((m) => m.UserId) : [],
      IsActive: team.IsActive,
    });
    setFormErrors({});
    setIsModalVisible(true);
  };

  const handleSaveTeam = async () => {
    if (!validateForm()) return;

    try {
      const teamData = {
        Id: selectedTeam ? selectedTeam.Id : 0,
        Name: formData.Name,
        Description: formData.Description,
        LeadUserId: formData.LeadUserId,
        Color: formData.Color,
        Members: formData.Members,
        IsActive: formData.IsActive,
        BranchId: 1,
        CompId: 1,
      };

      if (selectedTeam) {
        await updateTeamMutation.mutateAsync(teamData);
        setDialogState({
          visible: true,
          type: "success",
          title: "Success",
          message: "Team updated successfully",
          onConfirm: null,
          showCancel: false,
        });
      } else {
        await createTeamMutation.mutateAsync(teamData);
        setDialogState({
          visible: true,
          type: "success",
          title: "Success",
          message: "Team created successfully",
          onConfirm: null,
          showCancel: false,
        });
      }

      setIsModalVisible(false);
    } catch (error) {
      console.error("Error saving team:", error);

      // Use actual error message from API response
      const errorMessage =
        error?.response?.data?.message ||
        error?.message ||
        "Failed to save team";
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

  const handleDeleteTeam = (team) => {
    setDialogState({
      visible: true,
      type: "warning",
      title: "Delete Team",
      message: `Are you sure you want to delete ${team.Name}? This action cannot be undone.`,
      confirmText: "Delete",
      cancelText: "Cancel",
      showCancel: true,
      onConfirm: async () => {
        try {
          await deleteTeamMutation.mutateAsync(team.Id);

          setDialogState({
            visible: true,
            type: "success",
            title: "Success",
            message: "Team deleted successfully",
            onConfirm: null,
            showCancel: false,
          });
        } catch (error) {
          console.error("Error deleting team:", error);

          // Use actual error message from API response
          const errorMessage =
            error?.response?.data?.message ||
            error?.message ||
            "Failed to delete team";
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
    setSelectedTeam(null);
    setFormData({
      Name: "",
      Description: "",
      LeadUserId: null,
      Color: "#3B82F6",
      Members: [],
      IsActive: true,
    });
    setFormErrors({});
  };

  // Show error state
  if (isError) {
    return (
      <View style={styles.container}>
        <HeaderWithSearch
          title="Teams"
          navigation={navigation}
          searchText={searchText}
          setSearchText={setSearchText}
          searchPlaceholder="Search teams, managers, descriptions..."
        />
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>
            Error loading teams: {error?.message}
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

  if (isLoading && teams.length === 0) {
    return (
      <View style={styles.container}>
        <HeaderWithSearch
          title="Teams"
          navigation={navigation}
          searchText={searchText}
          setSearchText={setSearchText}
          searchPlaceholder="Search teams, managers, descriptions..."
        />
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading teams...</Text>
        </View>
      </View>
    );
  }

  const activeTeamsCount = teams.filter(
    (team) => team.IsActive === true
  ).length;
  const totalMembers = teams.reduce((sum, team) => {
    // Use actual Members array length if available, otherwise fall back to MemberCount
    const memberCount = team.Members
      ? team.Members.length
      : team.MemberCount || 0;
    return sum + memberCount;
  }, 0);
  const teamsWithLeads = teams.filter(
    (team) => team.LeadName || team.ManagerName
  ).length;

  return (
    <View style={styles.container}>
      {/* Header */}
      <HeaderWithSearch
        title="Teams"
        navigation={navigation}
        searchText={searchText}
        setSearchText={setSearchText}
        searchPlaceholder="Search teams, managers, descriptions..."
        statsData={{
          totalUsers: teams.length,
          activeUsers: activeTeamsCount,
          totalGroups: teamsWithLeads,
          labels: {
            total: "Total Teams",
            active: "Active Teams",
            groups: "Teams with Leads",
          },
        }}
      />

      {/* Teams List */}
      <FlatList
        data={filteredTeams}
        renderItem={({ item }) => (
          <TeamCard
            team={item}
            onEdit={handleEditTeam}
            onDelete={handleDeleteTeam}
          />
        )}
        keyExtractor={(item) => item.Id.toString()}
        style={styles.teamsList}
        contentContainerStyle={styles.teamsListContent}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No teams found</Text>
          </View>
        }
      />

      {/* FAB */}
      <FAB onPress={handleAddTeam} />

      {/* Bottom Sheet Modal */}
      <BottomSheetModal
        visible={isModalVisible}
        onClose={closeModal}
        title={selectedTeam ? "Edit Team" : "Add New Team"}
      >
        {/* Team Name - Full Width */}
        <FormField
          label="Team Name"
          value={formData.Name}
          onChangeText={(text) => setFormData({ ...formData, Name: text })}
          icon={<GroupIcon />}
          error={formErrors.Name}
        />

        {/* Team Lead - Full Width */}
        <SelectField
          label="Team Lead"
          value={formData.LeadUserId}
          onSelect={(value) => setFormData({ ...formData, LeadUserId: value })}
          options={users.map((user) => ({
            value: user.userid,
            label: user.FullName,
          }))}
          icon={<UserIcon />}
          error={formErrors.LeadUserId}
        />

        {/* Team Members - Full Width */}
        <MultiSelectField
          label="Team Members"
          value={formData.Members}
          onSelect={(value) => setFormData({ ...formData, Members: value })}
          options={users.map((user) => ({
            value: user.userid,
            label: user.FullName,
          }))}
          icon={<GroupIcon />}
          error={formErrors.Members}
          maxHeight={200}
        />

        {/* Team Color & Status - Side by Side */}
        <FieldRow>
          <SelectField
            label="Team Color"
            value={formData.Color}
            onSelect={(value) => setFormData({ ...formData, Color: value })}
            options={[
              { value: "#3B82F6", label: "Blue" },
              { value: "#10B981", label: "Green" },
              { value: "#F59E0B", label: "Orange" },
              { value: "#EF4444", label: "Red" },
              { value: "#8B5CF6", label: "Purple" },
              { value: "#06B6D4", label: "Cyan" },
              { value: "#84CC16", label: "Lime" },
              { value: "#F97316", label: "Deep Orange" },
              { value: "#EC4899", label: "Pink" },
              { value: "#6B7280", label: "Gray" },
            ]}
            icon={
              <View
                style={[
                  styles.colorPreview,
                  { backgroundColor: formData.Color },
                ]}
              />
            }
            error={formErrors.Color}
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

        {/* Description - Full Width */}
        <FormField
          label="Team Description"
          value={formData.Description}
          onChangeText={(text) =>
            setFormData({ ...formData, Description: text })
          }
          icon={<WorkIcon />}
          multiline={true}
          numberOfLines={3}
          error={formErrors.Description}
        />

        <View style={styles.modalActions}>
          <TouchableOpacity style={styles.btnCancel} onPress={closeModal}>
            <Text style={styles.btnCancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.btnSave}
            onPress={handleSaveTeam}
            disabled={
              createTeamMutation.isPending || updateTeamMutation.isPending
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
                {createTeamMutation.isPending || updateTeamMutation.isPending
                  ? selectedTeam
                    ? "Updating..."
                    : "Saving..."
                  : selectedTeam
                  ? "Update Team"
                  : "Save Team"}
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
  // Teams List
  teamsList: {
    flex: 1,
    paddingBottom: 80, // Account for FAB
  },
  teamsListContent: {
    padding: 15,
    paddingBottom: 100,
  },
  // Team Card
  teamCard: {
    backgroundColor: theme.colors.white,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: theme.colors.gray[100],
  },
  teamHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  teamTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  teamInfo: {
    marginBottom: 12,
  },
  avatarContainer: {
    width: 50,
    height: 50,
    borderRadius: 25,
    padding: 3,
    backgroundColor: theme.colors.white,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  teamAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
  },
  teamInitials: {
    color: theme.colors.white,
    fontSize: 18,
    fontWeight: theme.typography.fontWeights.bold,
  },
  teamDetails: {
    flex: 1,
    minWidth: 0, // Allow text to shrink
  },
  teamName: {
    fontSize: 16,
    fontWeight: theme.typography.fontWeights.bold,
    color: theme.colors.gray[800],
    marginBottom: 4,
  },
  teamManager: {
    fontSize: 12,
    color: theme.colors.primary.brand,
    fontWeight: theme.typography.fontWeights.normal,
    marginBottom: 2,
  },
  teamDescription: {
    fontSize: 12,
    color: theme.colors.gray[500],
  },
  statusChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  statusText: {
    fontSize: 10,
    fontWeight: theme.typography.fontWeights.normal,
    color: theme.colors.white,
  },
  teamActions: {
    flexDirection: "row",
    gap: 6,
    flexShrink: 0, // Prevent icons from shrinking
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
  teamMembers: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.gray[100],
    paddingTop: 12,
  },
  membersTitle: {
    fontSize: 12,
    fontWeight: theme.typography.fontWeights.semibold,
    color: theme.colors.gray[700],
    marginBottom: 8,
  },
  membersChipsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
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
    marginBottom: 4,
  },
  memberChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  memberChipText: {
    fontSize: 10,
    fontWeight: theme.typography.fontWeights.normal,
    color: theme.colors.white,
  },
  moreChip: {
    backgroundColor: theme.colors.gray[400],
  },
  moreChipText: {
    fontSize: 10,
    fontWeight: theme.typography.fontWeights.normal,
    color: theme.colors.white,
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
  colorPreview: {
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
});

export default TeamsScreen;
