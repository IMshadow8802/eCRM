// Generic hooks
export { useApiQuery, useManualApiQuery } from './useApiQuery.jsx';
export { useApiMutation, useDeleteMutation } from './useApiMutation.jsx';

// System monitoring hooks
export { useNetworkMonitor } from './useNetworkMonitor.js';
export { useTokenMonitor } from './useTokenMonitor.jsx';

// UI hooks
export { useConfirmation } from './useConfirmation.jsx';

// Task management hooks
export {
  // Query hooks
  useTasks,
  useTask,
  useTasksManual,
  useProjects,
  useTeams,
  useUsers,
  useTaskComments,
  useTaskTimeEntries,
  useTaskChecklist,
  useTaskDetails,
  
  // Mutation hooks
  useTaskMutation,
  useTaskStatusMutation,
  useDeleteTask,
  useToggleTaskBlocked,
  useAddTaskComment,
  useDeleteTaskComment,
  useLogTaskTime,
  useDeleteTimeEntry,
  useAddChecklistItem,
  useUpdateChecklistItem,
  useDeleteChecklistItem,
  
  // Utilities
  createTaskObject,
  cleanTaskObject,
  parseJsonField,
  TASK_QUERY_KEYS
} from './useTaskData.jsx';