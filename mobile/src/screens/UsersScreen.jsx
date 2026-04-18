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
import CheckboxField from "../components/CheckboxField";
import Dialog from "../components/Dialog";
import FAB from "../components/FAB";
import FieldRow from "../components/FieldRow";
import FormField from "../components/FormField";
import HeaderWithSearch from "../components/HeaderWithSearch";
import {
  CalendarIcon,
  DeleteIcon,
  EditIcon,
  EmailIcon,
  GroupIcon,
  LocationIcon,
  PasswordIcon,
  UserIcon,
  WorkIcon,
} from "../components/Icons";
import SelectField from "../components/SelectField";
import { theme } from "../constants/theme";
import {
  useCreateUser,
  useDeleteUser,
  useUpdateUser,
  useUserGroups,
  useUsers,
} from "../hooks/useUsers";

const UserCard = ({ user, onEdit, onDelete, onToggleStatus }) => {
  const getAvatarGradient = (name) => {
    const gradients = [
      ["#3F4FAF", "#5A6BC0"],
      ["#F9629F", "#FF7AB7"],
      ["#34D399", "#10B981"],
      ["#FBBF24", "#F59E0B"],
      ["#A78BFA", "#8B5CF6"],
      ["#EF4444", "#F87171"],
    ];
    const index = name?.charCodeAt(0) % gradients.length || 0;
    return gradients[index];
  };

  const getGroupTagColor = (groupName) => {
    const colorMap = {
      Administrators: { bg: "rgba(239,68,68,0.1)", color: "#EF4444" },
      "Project Managers": { bg: "rgba(251,191,36,0.1)", color: "#FBBF24" },
      Developers: { bg: "rgba(96,165,250,0.1)", color: "#60A5FA" },
      "QA Team": { bg: "rgba(167,139,250,0.1)", color: "#A78BFA" },
    };
    return (
      colorMap[groupName] || { bg: "rgba(156,163,175,0.1)", color: "#9CA3AF" }
    );
  };

  const avatarGradient = getAvatarGradient(user.FullName);
  const groupColors = getGroupTagColor(user.GroupName);

  return (
    <View style={styles.userCard}>
      <View style={styles.userHeader}>
        <View style={styles.userInfo}>
          <View style={styles.avatarContainer}>
            <LinearGradient
              colors={avatarGradient}
              style={styles.userAvatar}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <Text style={styles.userInitials}>
                {(user.FullName || user.username || "U")
                  .substring(0, 2)
                  .toUpperCase()}
              </Text>
            </LinearGradient>
          </View>
          <View style={styles.userDetails}>
            <Text style={styles.userName}>
              {user.FullName || user.username}
            </Text>
            <Text style={styles.userUsername}>@{user.username}</Text>
            <Text style={styles.userRole}>{user.JobTitle || "User"}</Text>
          </View>
        </View>
        <View style={styles.userActions}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => onEdit(user)}
          >
            <EditIcon size={16} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.deleteBtn]}
            onPress={() => onDelete(user)}
          >
            <DeleteIcon size={16} />
          </TouchableOpacity>
        </View>
      </View>
      <View style={styles.userTags}>
        {user.GroupName && (
          <View style={styles.chipContainer}>
            <View style={[styles.tag, { backgroundColor: groupColors.color }]}>
              <Text style={styles.tagText}>{user.GroupName}</Text>
            </View>
          </View>
        )}
        <View style={styles.chipContainer}>
          <View
            style={[
              styles.tag,
              {
                backgroundColor: user.useractive
                  ? theme.colors.status.success
                  : theme.colors.gray[400],
              },
            ]}
          >
            <Text style={styles.tagText}>
              {user.useractive ? "Active" : "Inactive"}
            </Text>
          </View>
        </View>
        <Text style={styles.userMeta}>{user.Email}</Text>
      </View>
    </View>
  );
};

const UsersScreen = ({ navigation }) => {
  const [searchText, setSearchText] = useState("");
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [formData, setFormData] = useState({
    Username: "",
    Password: "",
    FullName: "",
    Email: "",
    JobTitle: "",
    HourlyRate: "",
    GroupId: null,
    AllowDay: "",
    User_IP: "",
    UserActive: true,
    IsAdmin: false,
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
    data: users = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useUsers(searchText);

  const { data: userGroups = [], isLoading: isLoadingUserGroups } =
    useUserGroups();

  const createUserMutation = useCreateUser();
  const updateUserMutation = useUpdateUser();
  const deleteUserMutation = useDeleteUser();

  const statusOptions = [
    { value: true, label: "Active" },
    { value: false, label: "Inactive" },
  ];

  // Filter users using useMemo to prevent infinite re-renders
  const filteredUsers = useMemo(() => {
    if (!searchText) {
      return users;
    }

    return users.filter(
      (user) =>
        user.FullName?.toLowerCase().includes(searchText.toLowerCase()) ||
        user.username?.toLowerCase().includes(searchText.toLowerCase()) ||
        user.Email?.toLowerCase().includes(searchText.toLowerCase()) ||
        user.JobTitle?.toLowerCase().includes(searchText.toLowerCase())
    );
  }, [searchText, users]);

  const onRefresh = () => {
    refetch();
  };

  const validateForm = () => {
    const errors = {};

    if (!formData.Username.trim()) {
      errors.Username = "Username is required";
    } else if (formData.Username.length > 50) {
      errors.Username = "Username must be less than 50 characters";
    }

    if (formData.Email && !/\S+@\S+\.\S+/.test(formData.Email)) {
      errors.Email = "Please enter a valid email";
    }

    if (!formData.FullName.trim()) {
      errors.FullName = "Full name is required";
    } else if (formData.FullName.length > 100) {
      errors.FullName = "Full name must be less than 100 characters";
    }

    if (!formData.Password.trim()) {
      errors.Password = selectedUser 
        ? "Password is required (enter current password to keep unchanged, or new password to update)"
        : "Password is required for new users";
    } else if (formData.Password.length < 6) {
      errors.Password = "Password must be at least 6 characters";
    }

    if (formData.JobTitle && formData.JobTitle.length > 100) {
      errors.JobTitle = "Job title must be less than 100 characters";
    }

    if (formData.HourlyRate && isNaN(formData.HourlyRate)) {
      errors.HourlyRate = "Hourly rate must be a valid number";
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleAddUser = () => {
    setSelectedUser(null);
    setFormData({
      Username: "",
      Password: "",
      FullName: "",
      Email: "",
      JobTitle: "",
      HourlyRate: "",
      GroupId: null,
      AllowDay: "",
      User_IP: "",
      UserActive: true,
      IsAdmin: false,
    });
    setFormErrors({});
    setIsModalVisible(true);
  };

  const handleEditUser = (user) => {
    setSelectedUser(user);
    setFormData({
      Username: user.username,
      Password: "",
      FullName: user.FullName,
      Email: user.Email || "",
      JobTitle: user.JobTitle || "",
      HourlyRate: user.HourlyRate || "",
      GroupId: user.GroupId,
      AllowDay: user.AllowDay || "",
      User_IP: user.User_IP || "",
      UserActive: user.useractive,
      IsAdmin: user.isadmin || false,
    });
    setFormErrors({});
    setIsModalVisible(true);
  };

  const handleSaveUser = async () => {
    if (!validateForm()) return;

    try {
      // Map form data to API expected format based on corrected API docs
      let userData = {
        Id: selectedUser ? selectedUser.userid : 0,
        Username: formData.Username,
        FullName: formData.FullName,
        Email: formData.Email,
        JobTitle: formData.JobTitle,
        HourlyRate: parseFloat(formData.HourlyRate) || 0,
        GroupId: formData.GroupId,
        AllowDay: parseInt(formData.AllowDay) || 0,
        User_IP: formData.User_IP,
        UserActive: formData.UserActive,
        IsAdmin: formData.IsAdmin,
        CompId: 1, // Set default values
        BranchId: 1,
      };

      // Always include password as API requires it
      userData.Password = formData.Password;

      if (selectedUser) {
        await updateUserMutation.mutateAsync(userData);
        setDialogState({
          visible: true,
          type: "success",
          title: "Success",
          message: "User updated successfully",
          onConfirm: null,
          showCancel: false,
        });
      } else {
        await createUserMutation.mutateAsync(userData);
        setDialogState({
          visible: true,
          type: "success",
          title: "Success",
          message: "User created successfully",
          onConfirm: null,
          showCancel: false,
        });
      }

      setIsModalVisible(false);
    } catch (error) {
      console.error("Error saving user:", error);

      // Use actual error message from API response
      const errorMessage =
        error?.response?.data?.message ||
        error?.message ||
        "Failed to save user";
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

  const handleDeleteUser = (user) => {
    setDialogState({
      visible: true,
      type: "warning",
      title: "Delete User",
      message: `Are you sure you want to delete ${
        user.FullName || user.username
      }? This action cannot be undone.`,
      confirmText: "Delete",
      cancelText: "Cancel",
      showCancel: true,
      onConfirm: async () => {
        try {
          await deleteUserMutation.mutateAsync(user.userid);

          setDialogState({
            visible: true,
            type: "success",
            title: "Success",
            message: "User deleted successfully",
            onConfirm: null,
            showCancel: false,
          });
        } catch (error) {
          console.error("Error deleting user:", error);

          // Use actual error message from API response
          const errorMessage =
            error?.response?.data?.message ||
            error?.message ||
            "Failed to delete user";
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
    setSelectedUser(null);
    setFormData({
      Username: "",
      Password: "",
      FullName: "",
      Email: "",
      JobTitle: "",
      HourlyRate: "",
      GroupId: null,
      AllowDay: "",
      User_IP: "",
      UserActive: true,
      IsAdmin: false,
    });
    setFormErrors({});
  };

  // Show error state
  if (isError) {
    return (
      <View style={styles.container}>
        <HeaderWithSearch
          title="Users"
          navigation={navigation}
          searchText={searchText}
          setSearchText={setSearchText}
          searchPlaceholder="Search users, roles, groups..."
        />
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>
            Error loading users: {error?.message}
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

  if (isLoading && users.length === 0) {
    return (
      <View style={styles.container}>
        <HeaderWithSearch
          title="Users"
          navigation={navigation}
          searchText={searchText}
          setSearchText={setSearchText}
          searchPlaceholder="Search users, roles, groups..."
        />
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading users...</Text>
        </View>
      </View>
    );
  }

  const activeUsersCount = users.filter(
    (user) => user.useractive === true
  ).length;
  const uniqueGroups = [
    ...new Set(users.map((user) => user.GroupId).filter(Boolean)),
  ].length;

  return (
    <View style={styles.container}>
      {/* Header */}
      <HeaderWithSearch
        title="Users"
        navigation={navigation}
        searchText={searchText}
        setSearchText={setSearchText}
        searchPlaceholder="Search users, roles, groups..."
        statsData={{
          totalUsers: users.length,
          activeUsers: activeUsersCount,
          totalGroups: uniqueGroups,
        }}
      />

      {/* Users List */}
      <FlatList
        data={filteredUsers}
        renderItem={({ item }) => (
          <UserCard
            user={item}
            onEdit={handleEditUser}
            onDelete={handleDeleteUser}
          />
        )}
        keyExtractor={(item) => (item.userid || item.id).toString()}
        style={styles.usersList}
        contentContainerStyle={styles.usersListContent}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No users found</Text>
          </View>
        }
      />

      {/* FAB */}
      <FAB onPress={handleAddUser} />

      {/* Bottom Sheet Modal */}
      <BottomSheetModal
        visible={isModalVisible}
        onClose={closeModal}
        title={selectedUser ? "Edit User" : "Add New User"}
      >
        {/* Basic Information */}
        <FormField
          label="Username"
          value={formData.Username}
          onChangeText={(text) => setFormData({ ...formData, Username: text })}
          icon={<UserIcon />}
          error={formErrors.Username}
        />

        <FormField
          label="Full Name"
          value={formData.FullName}
          onChangeText={(text) => setFormData({ ...formData, FullName: text })}
          icon={<UserIcon />}
          error={formErrors.FullName}
        />

        <FormField
          label="Email"
          value={formData.Email}
          onChangeText={(text) => setFormData({ ...formData, Email: text })}
          icon={<EmailIcon />}
          keyboardType="email-address"
          error={formErrors.Email}
        />

        {/* Security Message for Password when Editing */}
        {selectedUser && (
          <View style={styles.securityMessage}>
            <Text style={styles.securityMessageText}>
              🔒 For security reasons, please either create a new password or re-enter the current password
            </Text>
          </View>
        )}

        <FormField
          label="Password"
          value={formData.Password}
          onChangeText={(text) =>
            setFormData({ ...formData, Password: text })
          }
          icon={<PasswordIcon />}
          secureTextEntry
          error={formErrors.Password}
          placeholder={selectedUser ? "Re-enter current password or create a new one" : "Enter password"}
        />

        {/* Work Information */}
        <FormField
          label="Job Title"
          value={formData.JobTitle}
          onChangeText={(text) => setFormData({ ...formData, JobTitle: text })}
          icon={<WorkIcon />}
          error={formErrors.JobTitle}
        />

        <FieldRow>
          <FormField
            label="Hourly Rate"
            value={formData.HourlyRate.toString()}
            onChangeText={(text) =>
              setFormData({ ...formData, HourlyRate: text })
            }
            icon={<WorkIcon />}
            keyboardType="numeric"
            error={formErrors.HourlyRate}
          />

          <FormField
            label="Allow Day"
            value={formData.AllowDay.toString()}
            onChangeText={(text) =>
              setFormData({ ...formData, AllowDay: text })
            }
            icon={<CalendarIcon />}
            keyboardType="numeric"
            error={formErrors.AllowDay}
          />
        </FieldRow>

        <SelectField
          label="User Group"
          value={formData.GroupId}
          onSelect={(value) => setFormData({ ...formData, GroupId: value })}
          options={userGroups.map((group) => ({
            value: group.grp_id,
            label: group.grp_name,
          }))}
          icon={<GroupIcon />}
          error={formErrors.GroupId}
        />

        {/* System Information */}
        <FormField
          label="User IP"
          value={formData.User_IP}
          onChangeText={(text) => setFormData({ ...formData, User_IP: text })}
          icon={<LocationIcon />}
          error={formErrors.User_IP}
        />

        {/* Permissions */}
        <FieldRow>
          <CheckboxField
            label="User Active"
            value={formData.UserActive}
            onValueChange={(value) =>
              setFormData({ ...formData, UserActive: value })
            }
            error={formErrors.UserActive}
          />

          <CheckboxField
            label="Is Admin"
            value={formData.IsAdmin}
            onValueChange={(value) =>
              setFormData({ ...formData, IsAdmin: value })
            }
            error={formErrors.IsAdmin}
          />
        </FieldRow>

        <View style={styles.modalActions}>
          <TouchableOpacity style={styles.btnCancel} onPress={closeModal}>
            <Text style={styles.btnCancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.btnSave}
            onPress={handleSaveUser}
            disabled={
              createUserMutation.isPending || updateUserMutation.isPending
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
                {createUserMutation.isPending || updateUserMutation.isPending
                  ? selectedUser
                    ? "Updating..."
                    : "Saving..."
                  : selectedUser
                  ? "Update User"
                  : "Save User"}
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
  // Users List
  usersList: {
    flex: 1,
    paddingBottom: 80, // Account for FAB
  },
  usersListContent: {
    padding: 15,
    paddingBottom: 100,
  },
  // User Card
  userCard: {
    backgroundColor: theme.colors.white,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  userHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  userInfo: {
    flexDirection: "row",
    flex: 1,
    gap: 12,
  },
  avatarContainer: {
    width: 45,
    height: 45,
    borderRadius: 22.5,
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
  userAvatar: {
    width: 39,
    height: 39,
    borderRadius: 19.5,
    justifyContent: "center",
    alignItems: "center",
  },
  userInitials: {
    color: theme.colors.white,
    fontSize: 16,
    fontWeight: theme.typography.fontWeights.semibold,
  },
  userDetails: {
    flex: 1,
  },
  userName: {
    fontSize: 14,
    fontWeight: theme.typography.fontWeights.semibold,
    color: theme.colors.gray[800],
    marginBottom: 3,
  },
  userUsername: {
    fontSize: 11,
    color: theme.colors.gray[500],
    marginBottom: 2,
  },
  userRole: {
    fontSize: 12,
    color: "#3F4FAF",
    fontWeight: theme.typography.fontWeights.normal,
  },
  userActions: {
    flexDirection: "row",
    gap: 6,
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
  // User Tags
  userTags: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
    alignItems: "center",
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
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  tagText: {
    fontSize: 10,
    fontWeight: theme.typography.fontWeights.semibold,
    color: theme.colors.white,
  },
  userMeta: {
    fontSize: 10,
    color: theme.colors.gray[400],
    marginLeft: "auto",
    maxWidth: 120,
    textAlign: "right",
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
  // Icons
  // User Icon
  userIcon: {
    width: 16,
    height: 16,
    position: "relative",
  },
  userIconHead: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.gray[500],
    position: "absolute",
    top: 0,
    left: 5,
  },
  userIconBody: {
    width: 12,
    height: 8,
    borderRadius: 6,
    backgroundColor: theme.colors.gray[500],
    position: "absolute",
    bottom: 0,
    left: 2,
  },
  // Email Icon
  emailIcon: {
    width: 16,
    height: 12,
    position: "relative",
  },
  emailIconBody: {
    width: 16,
    height: 12,
    borderRadius: 2,
    borderWidth: 2,
    borderColor: theme.colors.gray[500],
    backgroundColor: "transparent",
  },
  emailIconFlap: {
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderTopWidth: 6,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopColor: theme.colors.gray[500],
    position: "absolute",
    top: 2,
    left: 0,
  },
  // Briefcase Icon
  briefcaseIcon: {
    width: 16,
    height: 14,
    position: "relative",
  },
  briefcaseIconBody: {
    width: 16,
    height: 10,
    borderRadius: 2,
    backgroundColor: theme.colors.gray[500],
    position: "absolute",
    bottom: 0,
  },
  briefcaseIconHandle: {
    width: 6,
    height: 4,
    borderRadius: 2,
    borderWidth: 2,
    borderColor: theme.colors.gray[500],
    backgroundColor: "transparent",
    position: "absolute",
    top: 0,
    left: 5,
  },
  // Lock Icon
  lockIcon: {
    width: 16,
    height: 16,
    position: "relative",
  },
  lockIconBody: {
    width: 12,
    height: 8,
    borderRadius: 2,
    backgroundColor: theme.colors.gray[500],
    position: "absolute",
    bottom: 0,
    left: 2,
  },
  lockIconShackle: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: theme.colors.gray[500],
    backgroundColor: "transparent",
    position: "absolute",
    top: 0,
    left: 4,
  },
  // Status Icon
  statusIcon: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: theme.colors.status.success,
  },
  // Edit Icon
  editIcon: {
    width: 16,
    height: 16,
    position: "relative",
  },
  editIconPencil: {
    width: 2,
    height: 12,
    backgroundColor: theme.colors.gray[600],
    borderRadius: 1,
    position: "absolute",
    top: 2,
    left: 7,
    transform: [{ rotate: "45deg" }],
  },
  editIconTip: {
    width: 4,
    height: 4,
    backgroundColor: theme.colors.gray[600],
    borderRadius: 2,
    position: "absolute",
    top: 0,
    left: 6,
    transform: [{ rotate: "45deg" }],
  },
  // Play Icon
  playIcon: {
    width: 16,
    height: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  playTriangle: {
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderTopWidth: 6,
    borderBottomWidth: 6,
    borderLeftColor: theme.colors.status.success,
    borderTopColor: "transparent",
    borderBottomColor: "transparent",
    marginLeft: 2,
  },
  // Pause Icon
  pauseIcon: {
    width: 16,
    height: 16,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 2,
  },
  pauseBar: {
    width: 3,
    height: 10,
    backgroundColor: theme.colors.status.warning,
    borderRadius: 1,
  },
  // Delete Icon
  deleteIcon: {
    width: 16,
    height: 16,
    position: "relative",
  },
  deleteIconBody: {
    width: 10,
    height: 10,
    borderRadius: 2,
    backgroundColor: theme.colors.status.error,
    position: "absolute",
    bottom: 0,
    left: 3,
  },
  deleteIconLid: {
    width: 12,
    height: 2,
    borderRadius: 1,
    backgroundColor: theme.colors.status.error,
    position: "absolute",
    top: 2,
    left: 2,
  },
  deleteIconLine: {
    width: 2,
    height: 6,
    backgroundColor: theme.colors.white,
    borderRadius: 1,
    position: "absolute",
    bottom: 2,
    left: 7,
  },
  // Building Icon
  buildingIcon: {
    width: 16,
    height: 16,
    position: "relative",
  },
  buildingIconBody: {
    width: 12,
    height: 12,
    backgroundColor: theme.colors.gray[500],
    position: "absolute",
    bottom: 0,
    left: 2,
  },
  buildingIconRoof: {
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderBottomWidth: 4,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderBottomColor: theme.colors.gray[500],
    position: "absolute",
    top: 0,
    left: 0,
  },
  // Phone Icon
  phoneIcon: {
    width: 16,
    height: 16,
    position: "relative",
  },
  phoneIconBody: {
    width: 10,
    height: 16,
    borderRadius: 2,
    backgroundColor: theme.colors.gray[500],
    position: "absolute",
    left: 3,
  },
  // Location Icon
  locationIcon: {
    width: 16,
    height: 16,
    position: "relative",
  },
  locationIconBody: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: theme.colors.gray[500],
    backgroundColor: "transparent",
    position: "absolute",
    top: 0,
    left: 2,
  },
  locationIconPin: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.gray[500],
    position: "absolute",
    top: 4,
    left: 6,
  },
  // Group Icon
  groupIcon: {
    width: 16,
    height: 16,
    position: "relative",
  },
  groupIconPerson1: {
    width: 8,
    height: 12,
    borderRadius: 4,
    backgroundColor: theme.colors.gray[500],
    position: "absolute",
    top: 2,
    left: 1,
  },
  groupIconPerson2: {
    width: 8,
    height: 12,
    borderRadius: 4,
    backgroundColor: theme.colors.gray[400],
    position: "absolute",
    top: 2,
    right: 1,
  },
  // Security Message
  securityMessage: {
    backgroundColor: theme.colors.primary.brand + "08",
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.primary.brand,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  securityMessageText: {
    fontSize: 13,
    color: theme.colors.primary.brand,
    lineHeight: 18,
    fontWeight: theme.typography.fontWeights.medium,
  },
});

export default UsersScreen;
