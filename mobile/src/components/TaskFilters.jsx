import { useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { theme } from "../constants/theme";
import SelectField from "./SelectField";

const TaskFilters = ({
  selectedStatus,
  selectedProject,
  onStatusChange,
  onProjectChange,
  projects = [],
  kanbanColumns = [],
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  // Create status options from kanban columns
  const statusOptions = [
    { id: "all", label: "All Status" },
    ...kanbanColumns.map((column) => ({
      id: column.id || column.Id,
      label: column.title || column.Title || column.Name,
    })),
  ];

  // Create project options for SelectField (no "All Projects" option)
  const projectOptions = projects.map((project) => ({
    value: project.Id,
    label: project.Name,
  }));

  // Get current project name for display
  const currentProjectName =
    projects.find((p) => p.Id === selectedProject)?.Name || "Select Project";

  const toggleExpanded = () => {
    setIsExpanded(!isExpanded);
  };

  // Filter Icon Component
  const FilterIcon = () => (
    <View style={styles.filterIcon}>
      <View style={styles.filterIconLines}>
        <View style={[styles.filterLine, styles.filterLine1]} />
        <View style={[styles.filterLine, styles.filterLine2]} />
        <View style={[styles.filterLine, styles.filterLine3]} />
      </View>
      <View style={styles.filterFunnel} />
    </View>
  );

  // Chevron Icon Component
  const ChevronIcon = ({ isDown }) => (
    <View style={[styles.chevron, isDown && styles.chevronDown]}>
      <View style={styles.chevronLine1} />
      <View style={styles.chevronLine2} />
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Filter Toggle Bar */}
      <TouchableOpacity
        style={[styles.filterToggle, isExpanded && styles.filterToggleExpanded]}
        onPress={toggleExpanded}
      >
        <View style={styles.filterToggleLeft}>
          <FilterIcon />
          <Text style={styles.filterToggleText}>{currentProjectName}</Text>
        </View>
        <ChevronIcon isDown={isExpanded} />
      </TouchableOpacity>

      {/* Expandable Filters */}
      {isExpanded && (
        <View style={styles.expandedFilters}>
          {/* Project SelectField - Full Width Row */}
          <View style={styles.projectRow}>
            <SelectField
              label="Project"
              value={selectedProject}
              onSelect={(value) => onProjectChange(value)}
              options={projectOptions}
              placeholder="Select Project"
            />
          </View>

          {/* Status Filters Row */}
          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>Status:</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.statusScroll}
            >
              {statusOptions.map((status) => (
                <TouchableOpacity
                  key={status.id}
                  style={[
                    styles.filterButton,
                    selectedStatus === status.id && styles.filterButtonActive,
                  ]}
                  onPress={() => onStatusChange(status.id)}
                >
                  <Text
                    style={[
                      styles.filterText,
                      selectedStatus === status.id && styles.filterTextActive,
                    ]}
                  >
                    {status.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginTop: 20,
    marginHorizontal: 16,
    borderRadius: 12,
    backgroundColor: "transparent",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  // Filter Toggle Bar
  filterToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: theme.colors.white,
    borderRadius: 12,
  },
  filterToggleExpanded: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  filterToggleLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  filterToggleText: {
    fontSize: 14,
    color: theme.colors.gray[700],
    fontWeight: theme.typography.fontWeights.normal,
    marginLeft: 8,
  },
  // Filter Icon
  filterIcon: {
    width: 16,
    height: 16,
    position: "relative",
  },
  filterIconLines: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
  },
  filterLine: {
    height: 2,
    backgroundColor: theme.colors.gray[500],
    borderRadius: 1,
    marginBottom: 2,
  },
  filterLine1: {
    width: 14,
  },
  filterLine2: {
    width: 10,
    marginLeft: 2,
  },
  filterLine3: {
    width: 6,
    marginLeft: 4,
  },
  filterFunnel: {
    position: "absolute",
    bottom: 0,
    left: 6,
    width: 4,
    height: 6,
    backgroundColor: theme.colors.gray[500],
    borderRadius: 1,
  },
  // Chevron Icon
  chevron: {
    width: 12,
    height: 12,
    position: "relative",
  },
  chevronDown: {
    transform: [{ rotate: "180deg" }],
  },
  chevronLine1: {
    position: "absolute",
    top: 4,
    left: 2,
    width: 6,
    height: 2,
    backgroundColor: theme.colors.gray[500],
    borderRadius: 1,
    transform: [{ rotate: "45deg" }],
  },
  chevronLine2: {
    position: "absolute",
    top: 4,
    right: 2,
    width: 6,
    height: 2,
    backgroundColor: theme.colors.gray[500],
    borderRadius: 1,
    transform: [{ rotate: "-45deg" }],
  },
  // Expanded Filters
  expandedFilters: {
    backgroundColor: theme.colors.gray[50],
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: theme.colors.gray[200],
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
  },
  // Project Row - Full Width
  projectRow: {
    marginBottom: 16,
  },
  // Status Row
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  statusLabel: {
    fontSize: 14,
    fontWeight: theme.typography.fontWeights.semibold,
    color: theme.colors.gray[700],
    marginRight: 12,
    minWidth: 50,
  },
  statusScroll: {
    flex: 1,
  },
  filterButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
    borderRadius: 8,
    backgroundColor: theme.colors.gray[100],
    borderWidth: 1,
    borderColor: theme.colors.gray[300],
  },
  filterButtonActive: {
    backgroundColor: theme.colors.primary.brand,
    borderColor: theme.colors.primary.brand,
  },
  filterText: {
    fontSize: 14,
    color: theme.colors.gray[700],
    fontWeight: theme.typography.fontWeights.normal,
  },
  filterTextActive: {
    color: theme.colors.white,
    fontWeight: theme.typography.fontWeights.semibold,
  },
});

export default TaskFilters;
