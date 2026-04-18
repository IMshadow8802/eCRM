# Kanban API Documentation

## Overview
The Kanban API provides endpoints to manage kanban columns for projects. Each project can have its own set of customizable kanban columns that define task statuses and workflow stages.

**Base URL:** `/api/kanban`  
**Authentication:** Required (JWT Bearer token)

---

## Endpoints

### 1. Fetch Kanban Columns
**Endpoint:** `POST /api/kanban/fetch`

Retrieves kanban columns based on specified criteria.

#### Request Payload
```json
{
  "Id": 0,                    // INT: 0 = fetch all, >0 = fetch specific column
  "ProjectId": null           // INT: Filter by project ID (optional)
}
```

#### Response Format
```json
{
  "success": true,
  "message": "Kanban columns fetched successfully",
  "responseCode": 200,
  "data": {
    "columns": [
      {
        "Id": 1,
        "ProjectId": 1,
        "ProjectName": "E-Commerce Platform Redesign",
        "Title": "Backlog",
        "Color": "#3B82F6",
        "SortOrder": 1,
        "MaxTasks": null,
        "IsActive": true,
        "CompId": 1,
        "BranchId": 1,
        "CreatedDate": "2025-08-19T11:45:00.000Z"
      },
      {
        "Id": 2,
        "ProjectId": 1,
        "ProjectName": "E-Commerce Platform Redesign",
        "Title": "In Progress",
        "Color": "#FB923C",
        "SortOrder": 3,
        "MaxTasks": 5,
        "IsActive": true,
        "CompId": 1,
        "BranchId": 1,
        "CreatedDate": "2025-08-19T11:45:00.000Z"
      }
    ]
  },
  "timestamp": "2025-08-19T11:45:00.000Z"
}
```

#### Usage Examples
```javascript
// Fetch all columns for user's company/branch
const allColumns = await fetch('/api/kanban/fetch', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer your_token' },
  body: JSON.stringify({ "Id": 0 })
});

// Fetch columns for specific project
const projectColumns = await fetch('/api/kanban/fetch', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer your_token' },
  body: JSON.stringify({ "Id": 0, "ProjectId": 1 })
});

// Fetch specific column
const specificColumn = await fetch('/api/kanban/fetch', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer your_token' },
  body: JSON.stringify({ "Id": 5 })
});
```

---

### 2. Save Kanban Column (Create/Update)
**Endpoint:** `POST /api/kanban/save`

Creates a new kanban column or updates an existing one.

#### Request Payload
```json
{
  "Id": 0,                    // INT: 0 = create new, >0 = update existing
  "ProjectId": 1,             // INT: Required - Project ID
  "Title": "In Review",       // STRING: Required - Column title
  "Color": "#8093f1",         // STRING: Optional - Hex color code
  "SortOrder": 4,             // INT: Optional - Display order (auto-assigned if 0)
  "MaxTasks": 3,              // INT: Optional - Maximum tasks allowed in column
  "IsActive": true            // BOOLEAN: Optional - Default true
}
```

#### Response Format (Create - 201)
```json
{
  "success": true,
  "message": "Kanban column created successfully",
  "responseCode": 201,
  "data": {
    "columnId": 15
  },
  "timestamp": "2025-08-19T11:45:00.000Z"
}
```

#### Response Format (Update - 200)
```json
{
  "success": true,
  "message": "Kanban column updated successfully",
  "responseCode": 200,
  "data": {
    "columnId": 15
  },
  "timestamp": "2025-08-19T11:45:00.000Z"
}
```

#### Usage Examples
```javascript
// Create new column
const createColumn = await fetch('/api/kanban/save', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer your_token' },
  body: JSON.stringify({
    "Id": 0,
    "ProjectId": 1,
    "Title": "Code Review",
    "Color": "#9333EA",
    "SortOrder": 5,
    "MaxTasks": 10
  })
});

// Update existing column
const updateColumn = await fetch('/api/kanban/save', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer your_token' },
  body: JSON.stringify({
    "Id": 15,
    "ProjectId": 1,
    "Title": "Code Review - Updated",
    "Color": "#7C3AED",
    "MaxTasks": 8
  })
});
```

---

### 3. Delete Kanban Column
**Endpoint:** `POST /api/kanban/delete`

Soft deletes a kanban column (sets IsActive = false).

#### Request Payload
```json
{
  "Id": 15                    // INT: Required - Column ID to delete
}
```

#### Response Format (Success - 200)
```json
{
  "success": true,
  "message": "Kanban column deleted successfully",
  "responseCode": 200,
  "timestamp": "2025-08-19T11:45:00.000Z"
}
```

#### Response Format (Conflict - 409)
```json
{
  "success": false,
  "message": "Cannot delete column. 5 tasks are using this status",
  "responseCode": 409,
  "timestamp": "2025-08-19T11:45:00.000Z"
}
```

#### Usage Example
```javascript
// Delete column
const deleteColumn = await fetch('/api/kanban/delete', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer your_token' },
  body: JSON.stringify({
    "Id": 15
  })
});
```

---

## Error Responses

### Validation Errors (400)
```json
{
  "success": false,
  "message": "Project ID is required",
  "code": "VALIDATION_ERROR",
  "responseCode": 400,
  "timestamp": "2025-08-19T11:45:00.000Z"
}
```

### Not Found (404)
```json
{
  "success": false,
  "message": "Kanban column not found or access denied",
  "responseCode": 404,
  "timestamp": "2025-08-19T11:45:00.000Z"
}
```

### Conflict (409)
```json
{
  "success": false,
  "message": "Column with this title already exists in the project",
  "responseCode": 409,
  "timestamp": "2025-08-19T11:45:00.000Z"
}
```

### Server Error (500)
```json
{
  "success": false,
  "message": "Failed to save kanban column",
  "code": "KANBAN_SAVE_ERROR",
  "responseCode": 500,
  "timestamp": "2025-08-19T11:45:00.000Z"
}
```

---

## Field Descriptions

### Column Object
| Field | Type | Description |
|-------|------|-------------|
| `Id` | INT | Unique column identifier |
| `ProjectId` | INT | Project this column belongs to |
| `ProjectName` | STRING | Name of the associated project |
| `Title` | STRING | Display name of the column |
| `Color` | STRING | Hex color code for UI display |
| `SortOrder` | INT | Display order (1-based) |
| `MaxTasks` | INT | Maximum tasks allowed (null = unlimited) |
| `IsActive` | BOOLEAN | Whether column is active |
| `CompId` | INT | Company ID (for multi-tenant isolation) |
| `BranchId` | INT | Branch ID (for multi-tenant isolation) |
| `CreatedDate` | DATETIME | When column was created |

---

## Business Rules

1. **Project Association**: Each column must belong to a project
2. **Unique Titles**: Column titles must be unique within a project
3. **Sort Order**: If not specified, automatically assigned as max + 1
4. **Deletion Protection**: Cannot delete columns that have tasks using them
5. **Company Isolation**: Users can only access columns for their company/branch
6. **Task Status Mapping**: Task status field maps to column titles

---

## Integration with Tasks

When creating/updating tasks, the `Status` field should match the `Title` of an existing kanban column for that project:

```javascript
// Example task creation with kanban status
const createTask = await fetch('/api/tasks/save', {
  method: 'POST',
  body: JSON.stringify({
    "ProjectId": 1,
    "Title": "Fix login bug",
    "Status": "In Progress",  // Must match a kanban column title
    // ... other task fields
  })
});
```

---

## Common Workflows

### 1. Setup Project Kanban Board
```javascript
// 1. Create project columns
const columns = [
  { ProjectId: 1, Title: "Backlog", Color: "#6B7280", SortOrder: 1 },
  { ProjectId: 1, Title: "To Do", Color: "#3B82F6", SortOrder: 2 },
  { ProjectId: 1, Title: "In Progress", Color: "#F59E0B", SortOrder: 3, MaxTasks: 5 },
  { ProjectId: 1, Title: "Testing", Color: "#EF4444", SortOrder: 4, MaxTasks: 3 },
  { ProjectId: 1, Title: "Done", Color: "#10B981", SortOrder: 5 }
];

for (const column of columns) {
  await fetch('/api/kanban/save', {
    method: 'POST',
    body: JSON.stringify({ Id: 0, ...column })
  });
}
```

### 2. Get Project Kanban Board
```javascript
// Fetch all columns for project dashboard
const response = await fetch('/api/kanban/fetch', {
  method: 'POST',
  body: JSON.stringify({ Id: 0, ProjectId: 1 })
});

const { columns } = response.data;
// Sort by SortOrder for display
columns.sort((a, b) => a.SortOrder - b.SortOrder);
```

### 3. Move Task Between Columns
```javascript
// Update task status to move between kanban columns
await fetch('/api/tasks/save', {
  method: 'POST',
  body: JSON.stringify({
    Id: taskId,
    Status: "Testing"  // New column title
  })
});
```