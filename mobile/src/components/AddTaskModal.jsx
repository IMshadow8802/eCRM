import dayjs from "dayjs";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { theme } from "../constants/theme";
import BottomSheetModal from "./BottomSheetModal";
import DateField from "./DateField";
import FormField from "./FormField";
import SelectField from "./SelectField";

const AddTaskModal = ({
  visible,
  onClose,
  onCreateTask,
  columnId,
  columnTitle,
  projects = [],
  teams = [],
  users = [],
  currentProject = null,
}) => {
  // Get project details if currentProject is provided
  const selectedProjectData = useMemo(() => {
    if (currentProject && projects.length > 0) {
      return projects.find((project) => project.Id === currentProject);
    }
    return null;
  }, [currentProject, projects]);

  // Get the project's team details
  const selectedTeamData = useMemo(() => {
    if (selectedProjectData?.TeamId && teams.length > 0) {
      return teams.find((team) => team.Id === selectedProjectData.TeamId);
    }
    return null;
  }, [selectedProjectData?.TeamId, teams]);

  const [formData, setFormData] = useState({
    Title: "",
    Description: "",
    ProjectId: currentProject || "",
    AssignedToUserId: "",
    TeamId: selectedProjectData?.TeamId || "",
    Priority: "medium",
    Type: "task",
    EstimatedHours: "",
    DueDate: null,
  });

  const [errors, setErrors] = useState({});

  // Update form data when modal opens with project context
  useEffect(() => {
    if (visible && currentProject) {
      setFormData((prev) => ({
        ...prev,
        ProjectId: currentProject,
        TeamId: selectedProjectData?.TeamId || "",
        AssignedToUserId: "", // Reset assignee when team changes
      }));
    }
  }, [visible, currentProject, selectedProjectData?.TeamId]);

  // Prepare dropdown options
  const projectOptions = projects.map((project) => ({
    value: project.Id,
    label: project.Name,
  }));

  const teamOptions = teams.map((team) => ({
    value: team.Id,
    label: team.Name,
  }));

  const priorityOptions = [
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
  ];

  const typeOptions = [
    { value: "task", label: "Task" },
    { value: "feature", label: "Feature" },
    { value: "bug", label: "Bug" },
    { value: "improvement", label: "Improvement" },
  ];

  // Filter users based on selected team
  const availableUsers = useMemo(() => {
    if (formData.TeamId) {
      // If team is selected, show only team members
      const selectedTeam = teams.find((team) => team.Id === formData.TeamId);
      if (
        selectedTeam &&
        selectedTeam.Members &&
        selectedTeam.Members.length > 0
      ) {
        return selectedTeam.Members.map((member) => ({
          value: member.UserId,
          label: member.FullName,
        }));
      }
    }

    // Fallback to all users if no team selected or team has no members
    return users.map((user) => ({
      value: user.userid,
      label: user.FullName,
    }));
  }, [formData.TeamId, teams, users]);

  const validateForm = () => {
    const newErrors = {};

    if (!formData.Title.trim()) {
      newErrors.Title = "Task title is required";
    }

    if (!formData.ProjectId) {
      newErrors.ProjectId = "Project is required";
    }

    if (!formData.AssignedToUserId) {
      newErrors.AssignedToUserId = "Assignee is required";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = () => {
    if (!validateForm()) {
      return;
    }

    const taskData = {
      Id: 0, // New task
      Title: formData.Title,
      Description: formData.Description || "",
      ProjectId: formData.ProjectId,
      AssignedToUserId: formData.AssignedToUserId,
      TeamId: formData.TeamId || null,
      Priority: formData.Priority,
      Type: formData.Type,
      Status: columnId,
      DueDate: formData.DueDate
        ? dayjs(formData.DueDate).format("YYYY-MM-DD")
        : null,
      EstimatedHours: formData.EstimatedHours
        ? parseFloat(formData.EstimatedHours)
        : 0,
      LoggedHours: 0,
      Progress: 0,
      IsBlocked: false,
      Labels: "[]",
      Watchers: "[1]", // Current user as watcher
      Dependencies: "[]",
    };

    onCreateTask(taskData);
    handleClose();
  };

  const handleClose = () => {
    // Reset form but keep project and team context
    setFormData({
      Title: "",
      Description: "",
      ProjectId: currentProject || "",
      AssignedToUserId: "",
      TeamId: selectedProjectData?.TeamId || "",
      Priority: "medium",
      Type: "task",
      EstimatedHours: "",
      DueDate: null,
    });
    setErrors({});
    onClose();
  };

  const updateFormData = (field, value) => {
    setFormData((prev) => {
      const newData = { ...prev, [field]: value };

      // Clear assignee when team changes
      if (field === "TeamId" && value !== prev.TeamId) {
        newData.AssignedToUserId = "";
      }

      return newData;
    });

    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: null }));
    }
  };

  return (
    <>
      <BottomSheetModal
        visible={visible}
        onClose={handleClose}
        title={`Add Task to ${columnTitle}`}
      >
        {/* Task Title */}
        <FormField
          label="Task Title"
          value={formData.Title}
          onChangeText={(text) => updateFormData("Title", text)}
          error={errors.Title}
        />

        {/* Description */}
        <FormField
          label="Description"
          value={formData.Description}
          onChangeText={(text) => updateFormData("Description", text)}
          multiline
          numberOfLines={3}
        />

        {/* Project Selection */}
        <SelectField
          label="Project"
          value={formData.ProjectId}
          onSelect={(value) => updateFormData("ProjectId", value)}
          options={projectOptions}
          error={errors.ProjectId}
        />

        {/* Team Selection */}
        <SelectField
          label="Team"
          value={formData.TeamId}
          onSelect={(value) => updateFormData("TeamId", value)}
          options={teamOptions}
        />

        {/* Assignee Selection - filtered by team */}
        <SelectField
          label="Assigned To"
          value={formData.AssignedToUserId}
          onSelect={(value) => updateFormData("AssignedToUserId", value)}
          options={availableUsers}
          error={errors.AssignedToUserId}
        />

        {/* Priority */}
        <SelectField
          label="Priority"
          value={formData.Priority}
          onSelect={(value) => updateFormData("Priority", value)}
          options={priorityOptions}
        />

        {/* Task Type */}
        <SelectField
          label="Task Type"
          value={formData.Type}
          onSelect={(value) => updateFormData("Type", value)}
          options={typeOptions}
        />

        {/* Due Date */}
        <DateField
          label="Due Date"
          value={formData.DueDate}
          onChange={(date) => updateFormData("DueDate", date)}
          format="YYYY-MM-DD"
          minimumDate={new Date()}
        />

        {/* Estimated Hours */}
        <FormField
          label="Estimated Hours"
          value={formData.EstimatedHours}
          onChangeText={(text) => updateFormData("EstimatedHours", text)}
          keyboardType="numeric"
        />

        {/* Action Buttons */}
        <View style={styles.modalActions}>
          <TouchableOpacity style={styles.btnCancel} onPress={handleClose}>
            <Text style={styles.btnCancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnSave} onPress={handleSubmit}>
            <LinearGradient
              colors={[
                theme.colors.primary.secondaryLight,
                theme.colors.primary.secondary,
              ]}
              style={styles.btnSaveGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <Text style={styles.btnSaveText}>Create Task</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </BottomSheetModal>
    </>
  );
};

const styles = StyleSheet.create({
  // Modal Actions - matching Users modal exactly
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

export default AddTaskModal;
