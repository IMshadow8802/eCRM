import { useState } from "react";
import { Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { theme } from "../constants/theme";

const TaskCard = ({ task, onPress, kanbanColumns = [], onMoveTask }) => {
  const [showMoveMenu, setShowMoveMenu] = useState(false);
  const getPriorityColor = (priority) => {
    switch (priority) {
      case "high":
        return theme.colors.red[500];
      case "medium":
        return theme.colors.status.warning;
      case "low":
        return theme.colors.green[500];
      default:
        return theme.colors.gray[400];
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return null;
    const date = new Date(dateString);
    const today = new Date();
    const diffTime = date.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Tomorrow";
    if (diffDays === -1) return "Yesterday";
    if (diffDays > 0) return `${diffDays}d left`;
    if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`;

    return date.toLocaleDateString("en-GB");
  };

  const isOverdue = (dateString) => {
    if (!dateString) return false;
    const date = new Date(dateString);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date < today;
  };

  return (
    <View style={styles.card}>
      <TouchableOpacity
        onPress={() => onPress && onPress(task)}
        activeOpacity={0.7}
      >
        {/* Task Header */}
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={2}>
            {task.Title}
          </Text>
          <View style={styles.headerRight}>
            <View
              style={[
                styles.priorityBadge,
                { backgroundColor: getPriorityColor(task.Priority) },
              ]}
            >
              <Text style={styles.priorityText}>{task.Priority}</Text>
            </View>
            <TouchableOpacity
              style={styles.menuButton}
              onPress={() => setShowMoveMenu(true)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.menuDots}>⋮</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Task ID */}
        <View style={styles.taskIdContainer}>
          <Text style={styles.taskId}>#{task.Id}</Text>
        </View>

        {/* Description */}
        {task.Description && (
          <Text style={styles.description} numberOfLines={2}>
            {task.Description}
          </Text>
        )}

        {/* Task Info */}
        <View style={styles.infoSection}>
          {/* Due Date */}
          {task.DueDate && (
            <View
              style={[
                styles.dueDateContainer,
                isOverdue(task.DueDate) && styles.overdueContainer,
              ]}
            >
              <Text
                style={[
                  styles.dueDateText,
                  isOverdue(task.DueDate) && styles.overdueText,
                ]}
              >
                📅 {formatDate(task.DueDate)}
              </Text>
            </View>
          )}

          {/* Project */}
          <Text style={styles.projectName} numberOfLines={1}>
            📁 {task.ProjectName}
          </Text>
        </View>

        {/* Bottom Info */}
        <View style={styles.bottomSection}>
          {/* Assignee */}
          <View style={styles.assigneeContainer}>
            <View style={styles.assigneeAvatar}>
              <Text style={styles.assigneeInitial}>
                {task.AssigneeName?.charAt(0) || "?"}
              </Text>
            </View>
            <Text style={styles.assigneeName} numberOfLines={1}>
              {task.AssigneeName}
            </Text>
          </View>

          {/* Hours */}
          {(task.EstimatedHours > 0 || task.LoggedHours > 0) && (
            <View style={styles.hoursContainer}>
              <Text style={styles.hoursText}>
                {task.LoggedHours}h / {task.EstimatedHours}h
              </Text>
            </View>
          )}
        </View>
      </TouchableOpacity>

      {/* Move to Column Modal */}
      <Modal
        visible={showMoveMenu}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowMoveMenu(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowMoveMenu(false)}
        >
          <View style={styles.menuContainer}>
            <Text style={styles.menuTitle}>Move task to:</Text>

            {kanbanColumns
              .filter((column) => column.IsActive && column.Id !== task.Status)
              .map((column) => (
                <TouchableOpacity
                  key={column.Id}
                  style={[styles.menuItem, { borderLeftColor: column.Color }]}
                  onPress={() => {
                    setShowMoveMenu(false);
                    if (onMoveTask) {
                      onMoveTask(task, column.Id);
                    }
                  }}
                >
                  <Text style={styles.menuItemText}>{column.Title}</Text>
                </TouchableOpacity>
              ))}

            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => setShowMoveMenu(false)}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.white,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: theme.colors.gray[200],
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 8,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: theme.typography.fontWeights.bold,
    color: theme.colors.gray[800],
    flex: 1,
    marginRight: 8,
    lineHeight: 20,
  },
  menuButton: {
    padding: 4,
    borderRadius: 4,
    backgroundColor: theme.colors.gray[100],
  },
  menuDots: {
    fontSize: 16,
    fontWeight: "bold",
    color: theme.colors.gray[600],
    lineHeight: 16,
  },
  priorityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    minWidth: 60,
    alignItems: "center",
  },
  priorityText: {
    fontSize: 10,
    fontWeight: theme.typography.fontWeights.normal,
    color: theme.colors.white,
    textTransform: "capitalize",
  },
  taskIdContainer: {
    marginBottom: 8,
  },
  taskId: {
    fontSize: 12,
    fontWeight: theme.typography.fontWeights.normal,
    color: theme.colors.primary.brand,
  },
  description: {
    fontSize: 14,
    color: theme.colors.gray[600],
    lineHeight: 18,
    marginBottom: 12,
  },
  infoSection: {
    marginBottom: 12,
  },
  dueDateContainer: {
    backgroundColor: theme.colors.green[50],
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    marginBottom: 8,
    alignSelf: "flex-start",
  },
  overdueContainer: {
    backgroundColor: theme.colors.red[50],
  },
  dueDateText: {
    fontSize: 12,
    color: theme.colors.green[700],
    fontWeight: theme.typography.fontWeights.normal,
  },
  overdueText: {
    color: theme.colors.red[700],
  },
  projectName: {
    fontSize: 12,
    color: theme.colors.gray[500],
    fontWeight: theme.typography.fontWeights.normal,
  },
  bottomSection: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  assigneeContainer: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  assigneeAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: theme.colors.primary.brand,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 8,
  },
  assigneeInitial: {
    fontSize: 10,
    fontWeight: theme.typography.fontWeights.bold,
    color: theme.colors.white,
  },
  assigneeName: {
    fontSize: 12,
    color: theme.colors.gray[700],
    fontWeight: theme.typography.fontWeights.normal,
    flex: 1,
  },
  hoursContainer: {
    backgroundColor: theme.colors.blue[50],
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  hoursText: {
    fontSize: 10,
    color: theme.colors.blue[700],
    fontWeight: theme.typography.fontWeights.normal,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  menuContainer: {
    backgroundColor: theme.colors.white,
    borderRadius: 16,
    padding: 24,
    marginHorizontal: 16,
    width: "90%",
    maxWidth: 400,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 8,
    },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 12,
  },
  menuTitle: {
    fontSize: 18,
    fontWeight: theme.typography.fontWeights.bold,
    color: theme.colors.gray[800],
    marginBottom: 20,
    textAlign: "center",
  },
  menuItem: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 12,
    marginBottom: 10,
    backgroundColor: theme.colors.gray[50],
    borderLeftWidth: 6,
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderTopColor: theme.colors.gray[200],
    borderRightColor: theme.colors.gray[200],
    borderBottomColor: theme.colors.gray[200],
    // borderLeftColor will be set dynamically from column.Color
  },
  menuItemText: {
    fontSize: 16,
    color: theme.colors.gray[800],
    fontWeight: theme.typography.fontWeights.semibold,
  },
  cancelButton: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: theme.colors.gray[200],
    marginTop: 12,
    borderWidth: 1,
    borderColor: theme.colors.gray[300],
  },
  cancelButtonText: {
    fontSize: 16,
    color: theme.colors.gray[700],
    fontWeight: theme.typography.fontWeights.semibold,
    textAlign: "center",
  },
});

export default TaskCard;
