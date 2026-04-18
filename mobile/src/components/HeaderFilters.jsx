import { StyleSheet, View } from "react-native";
import FilterSelect from "./FilterSelect";

const HeaderFilters = ({
  selectedStatus,
  selectedProject,
  onStatusChange,
  onProjectChange,
  projects = [],
  kanbanColumns = [],
}) => {
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

  return (
    <View style={styles.container}>
      {/* Project FilterSelect - Subtle like SearchBar */}
      <FilterSelect
        value={selectedProject}
        onSelect={(value) => onProjectChange(value)}
        options={projectOptions}
        placeholder="Select Project"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: "transparent",
  },
});

export default HeaderFilters;
