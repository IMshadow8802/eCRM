// Shared by the details form (TaskDetailModal) and the draft hook that
// normalises task.Priority against it — hence here rather than in either.
export const PRIORITY_TONE = {
  low: "info",
  medium: "warning",
  high: "error",
  critical: "error",
};

export const PRIORITY_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];
