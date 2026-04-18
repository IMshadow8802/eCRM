# API Endpoint Migration Guide

## Overview
All API endpoints have been updated to use camelCase naming for better network tab debugging and development experience.

## Authentication Endpoints
| Old Endpoint | New Endpoint |
|--------------|--------------|
| `/api/auth/login` | `/api/auth/loginUser` |
| `/api/auth/logout` | `/api/auth/logoutUser` |
| `/api/auth/hash-password` | `/api/auth/hashPassword` |

## User Management Endpoints
| Old Endpoint | New Endpoint |
|--------------|--------------|
| `/api/users/save` | `/api/users/saveUser` |
| `/api/users/fetch` | `/api/users/fetchUsers` |
| `/api/users/delete` | `/api/users/deleteUser` |

## User Groups Endpoints
| Old Endpoint | New Endpoint |
|--------------|--------------|
| `/api/user-groups/save` | `/api/user-groups/saveUserGroup` |
| `/api/user-groups/fetch` | `/api/user-groups/fetchUserGroups` |
| `/api/user-groups/delete` | `/api/user-groups/deleteUserGroup` |

## Team Management Endpoints
| Old Endpoint | New Endpoint | Notes |
|--------------|--------------|-------|
| `/api/teams/save` | `/api/teams/saveTeam` | |
| `/api/teams/fetch` | `/api/teams/fetchTeams` | |
| `/api/teams/delete` | `/api/teams/deleteTeam` | |
| `/api/teams/add-member` | ~~REMOVED~~ | Use Members array in saveTeam |
| `/api/teams/members` | ~~REMOVED~~ | Members included in fetchTeams |
| `/api/teams/remove-member` | ~~REMOVED~~ | Use Members array in saveTeam |

## Project Management Endpoints
| Old Endpoint | New Endpoint |
|--------------|--------------|
| `/api/projects/save` | `/api/projects/saveProject` |
| `/api/projects/fetch` | `/api/projects/fetchProjects` |

## Task Management Endpoints
| Old Endpoint | New Endpoint |
|--------------|--------------|
| `/api/tasks/save` | `/api/tasks/saveTask` |
| `/api/tasks/fetch` | `/api/tasks/fetchTasks` |
| `/api/tasks/delete` | `/api/tasks/deleteTask` |
| `/api/tasks/bulk-delete` | `/api/tasks/bulkDeleteTasks` |
| `/api/tasks/comment` | `/api/tasks/addTaskComment` |
| `/api/tasks/comments` | `/api/tasks/getTaskComments` |
| `/api/tasks/delete-comment` | `/api/tasks/deleteTaskComment` |
| `/api/tasks/log-time` | `/api/tasks/logTaskTime` |
| `/api/tasks/time-entries` | `/api/tasks/getTaskTimeEntries` |
| `/api/tasks/delete-time-entry` | `/api/tasks/deleteTaskTimeEntry` |
| `/api/tasks/save-checklist` | `/api/tasks/saveTaskChecklist` |
| `/api/tasks/checklist` | `/api/tasks/getTaskChecklist` |
| `/api/tasks/delete-checklist` | `/api/tasks/deleteTaskChecklist` |
| `/api/tasks/activity` | `/api/tasks/getTaskActivity` |

## Kanban Board Endpoints
| Old Endpoint | New Endpoint |
|--------------|--------------|
| `/api/kanban/save` | `/api/kanban/saveKanbanColumn` |
| `/api/kanban/fetch` | `/api/kanban/fetchKanbanColumns` |
| `/api/kanban/delete` | `/api/kanban/deleteKanbanColumn` |

## Benefits
- **Clear Network Tab**: Shows resource names (users, tasks, teams) instead of generic operations (fetch, save, delete)
- **Better Debugging**: Instantly identify what's being operated on
- **JavaScript Convention**: Follows camelCase naming standards
- **Simplified Team API**: Team members now managed via Members array in team operations