# CRM API Documentation

## Overview
This is a comprehensive Node.js CRM (Customer Relationship Management) API built with Express.js and SQL Server. The application provides task management, project management, team collaboration, and kanban board functionality with JWT authentication and role-based access control.

**Base URL:** `http://localhost:3000` (or your configured server URL)
**API Version:** 2.0.0
**Database:** SQL Server (eCRM+)

## Authentication

All API endpoints (except auth endpoints) require a valid JWT token in the Authorization header.

```
Authorization: Bearer <your-jwt-token>
```

### Authentication Endpoints

#### Login
- **URL:** `POST /api/auth/login`
- **Description:** User login with username and password
- **Headers:** `Content-Type: application/json`

**Request Body:**
```json
{
  "username": "string",
  "password": "string"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Login successful",
  "responseCode": 200,
  "data": {
    "token": "jwt-token-string",
    "user": {
      "userid": 1,
      "username": "john_doe",
      "FullName": "John Doe",
      "Email": "john@example.com",
      "isadmin": false,
      "CompId": 1,
      "BranchId": 1,
      "GroupId": 8,
      "JobTitle": "Developer"
    },
    "permissions": {
      "menus": [
        {
          "menuid": 1,
          "menuname": "Dashboard",
          "menuurl": "/dashboard",
          "parentid": 0,
          "canAdd": true,
          "canEdit": true,
          "canDelete": false,
          "canView": true,
          "children": []
        }
      ]
    }
  },
  "timestamp": "2025-08-03T05:30:00.000Z"
}
```

#### Logout
- **URL:** `POST /api/auth/logout`
- **Description:** User logout
- **Headers:** `Authorization: Bearer <token>`

**Request Body:** `{}` (empty)

**Success Response (200):**
```json
{
  "success": true,
  "message": "Logout successful",
  "responseCode": 200,
  "timestamp": "2025-08-03T05:30:00.000Z"
}
```

#### Hash Password
- **URL:** `POST /api/auth/hash-password`
- **Description:** Generate bcrypt hash for password (utility endpoint)

**Request Body:**
```json
{
  "password": "plaintext-password"
}
```

---

## User Management

All user endpoints require authentication.

#### Create/Update User
- **URL:** `POST /api/users/save`
- **Description:** Create new user (Id=0) or update existing user (Id>0)

**Request Body:**
```json
{
  "Id": 0,
  "Username": "john_doe",
  "Password": "secure_password",
  "UserActive": true,
  "IsAdmin": false,
  "User_IP": "192.168.1.100",
  "AllowDay": 0,
  "FullName": "John Doe",
  "Email": "john@example.com",
  "JobTitle": "Software Developer",
  "HourlyRate": 50.00,
  "GroupId": 8,
  "CompId": 1,
  "BranchId": 1
}
```

**Success Response (201/200):**
```json
{
  "success": true,
  "message": "User created successfully",
  "responseCode": 201,
  "data": {
    "userId": 123,
    "assignedGroupId": 8
  },
  "timestamp": "2025-08-03T05:30:00.000Z"
}
```

#### Fetch Users
- **URL:** `POST /api/users/fetch`
- **Description:** Get users with pagination and search (includes GroupId and GroupName from user groups)

**Request Body:**
```json
{
  "Id": 0,
  "PageNumber": 1,
  "PageSize": 10,
  "SearchTerm": "john"
}
```

**Minimal Request (with defaults):**
```json
{}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Users fetched successfully",
  "responseCode": 200,
  "data": {
    "users": [
      {
        "userid": 1,
        "username": "john_doe",
        "FullName": "John Doe",
        "Email": "john@example.com",
        "JobTitle": "Developer",
        "useractive": true,
        "isadmin": false,
        "GroupId": 8,
        "GroupName": "General Users",
        "HourlyRate": 50.00,
        "CompId": 1,
        "BranchId": 1,
        "CreatedDate": "2025-08-03T05:30:00.000Z"
      }
    ],
    "pagination": {
      "currentPage": 1,
      "pageSize": 10,
      "totalRecords": 25,
      "totalPages": 3
    }
  },
  "timestamp": "2025-08-03T05:30:00.000Z"
}
```

**No Data Found Response (200):**
```json
{
  "success": true,
  "message": "No users found",
  "responseCode": 200,
  "data": {
    "users": [],
    "pagination": {
      "currentPage": 1,
      "pageSize": 10,
      "totalRecords": 0,
      "totalPages": 0
    }
  },
  "timestamp": "2025-08-03T05:30:00.000Z"
}
```

#### Delete User
- **URL:** `POST /api/users/delete`
- **Description:** Delete user with cascade protection

**Request Body:**
```json
{
  "Id": 123
}
```

---

## Team Management

#### Create/Update Team
- **URL:** `POST /api/teams/save`
- **Description:** Create new team (Id=0) or update existing team (Id>0)

**Request Body:**
```json
{
  "Id": 0,
  "Name": "Development Team",
  "Description": "Frontend and Backend developers",
  "LeadUserId": 5,
  "Color": "#3498db",
  "Members": [1, 2, 3, 4, 5],
  "IsActive": true,
  "CompId": 1,
  "BranchId": 1
}
```

**Success Response (201/200):**
```json
{
  "success": true,
  "message": "Team created successfully",
  "responseCode": 201,
  "data": {
    "teamId": 10,
    "memberCount": 5
  },
  "timestamp": "2025-08-03T05:30:00.000Z"
}
```

#### Fetch Teams
- **URL:** `POST /api/teams/fetch`
- **Description:** Get teams with pagination and search

**Request Body:**
```json
{
  "Id": 0,
  "PageNumber": 1,
  "PageSize": 10,
  "SearchTerm": "dev"
}
```

#### Add Team Member
- **URL:** `POST /api/teams/add-member`
- **Description:** Add individual member to existing team

**Request Body:**
```json
{
  "TeamId": 10,
  "UserId": 6,
  "JoinedDate": "2025-08-03",
  "IsActive": true
}
```

#### Get Team Members
- **URL:** `POST /api/teams/members`
- **Description:** Get all members of a specific team

**Request Body:**
```json
{
  "TeamId": 10,
  "PageNumber": 1,
  "PageSize": 20
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Team members fetched successfully",
  "responseCode": 200,
  "data": {
    "members": [
      {
        "id": 1,
        "teamId": 10,
        "userId": 1,
        "fullName": "John Doe",
        "email": "john@example.com",
        "jobTitle": "Developer",
        "joinedDate": "2025-08-01",
        "isActive": true
      }
    ],
    "pagination": {
      "currentPage": 1,
      "pageSize": 20,
      "totalRecords": 5,
      "totalPages": 1
    }
  },
  "timestamp": "2025-08-03T05:30:00.000Z"
}
```

---

## Project Management

#### Create/Update Project
- **URL:** `POST /api/projects/save`
- **Description:** Create new project (Id=0) or update existing project (Id>0)

**Request Body:**
```json
{
  "Id": 0,
  "Name": "E-commerce Platform",
  "Description": "Complete online store solution",
  "ManagerId": 5,
  "TeamId": 10,
  "Budget": 50000.00,
  "StartDate": "2025-08-01",
  "EndDate": "2025-12-31",
  "Status": "In Progress",
  "Members": [1, 2, 3, 4],
  "Watchers": [6, 7],
  "IsActive": true
}
```

#### Fetch Projects
- **URL:** `POST /api/projects/fetch`
- **Description:** Get projects with access control filtering

**Request Body:**
```json
{
  "Id": 0,
  "PageNumber": 1,
  "PageSize": 10,
  "SearchTerm": "ecommerce"
}
```

#### Delete Project
- **URL:** `POST /api/projects/delete`
- **Description:** Delete project with validation

**Request Body:**
```json
{
  "Id": 15
}
```

---

## Task Management

#### Create/Update Task
- **URL:** `POST /api/tasks/save`
- **Description:** Create new task (Id=0) or update existing task (Id>0)

**Request Body:**
```json
{
  "Id": 0,
  "Title": "Implement user authentication",
  "Description": "Add JWT-based authentication system",
  "ProjectId": 15,
  "AssignedTo": 3,
  "CreatedBy": 1,
  "ParentTaskId": 0,
  "Priority": "High",
  "Status": "In Progress",
  "StartDate": "2025-08-03",
  "DueDate": "2025-08-10",
  "EstimatedHours": 16,
  "CompletionPercentage": 25,
  "Members": [1, 2, 3],
  "Watchers": [4, 5],
  "Tags": "authentication,security,backend",
  "IsActive": true
}
```

#### Fetch Tasks
- **URL:** `POST /api/tasks/fetch`
- **Description:** Get tasks with filters and pagination

**Request Body:**
```json
{
  "Id": 0,
  "ProjectId": 15,
  "AssignedTo": 3,
  "Status": "In Progress",
  "Priority": "High",
  "ParentTaskId": 0,
  "PageNumber": 1,
  "PageSize": 10,
  "SearchTerm": "auth"
}
```

#### Delete Task
- **URL:** `POST /api/tasks/delete`
- **Description:** Delete single task

**Request Body:**
```json
{
  "Id": 25
}
```

#### Bulk Delete Tasks
- **URL:** `POST /api/tasks/bulk-delete`
- **Description:** Delete multiple tasks at once

**Request Body:**
```json
{
  "TaskIds": [25, 26, 27]
}
```

### Task Comments

#### Add Comment
- **URL:** `POST /api/tasks/comment`
- **Description:** Add comment to task

**Request Body:**
```json
{
  "TaskId": 25,
  "Comment": "Updated the authentication logic",
  "ParentCommentId": 0
}
```

#### Get Comments
- **URL:** `POST /api/tasks/comments`
- **Description:** Get all comments for a task

**Request Body:**
```json
{
  "TaskId": 25,
  "PageNumber": 1,
  "PageSize": 20
}
```

#### Delete Comment
- **URL:** `POST /api/tasks/delete-comment`
- **Description:** Delete task comment

**Request Body:**
```json
{
  "Id": 15
}
```

### Time Tracking

#### Log Time Entry
- **URL:** `POST /api/tasks/log-time`
- **Description:** Log time spent on task

**Request Body:**
```json
{
  "TaskId": 25,
  "HoursWorked": 4.5,
  "WorkDate": "2025-08-03",
  "Description": "Implemented JWT middleware",
  "BillableHours": 4.5
}
```

#### Get Time Entries
- **URL:** `POST /api/tasks/time-entries`
- **Description:** Get time entries for task

**Request Body:**
```json
{
  "TaskId": 25,
  "PageNumber": 1,
  "PageSize": 20
}
```

#### Delete Time Entry
- **URL:** `POST /api/tasks/delete-time-entry`
- **Description:** Delete time entry

**Request Body:**
```json
{
  "Id": 10
}
```

### Task Checklist

#### Save Checklist Item
- **URL:** `POST /api/tasks/save-checklist`
- **Description:** Create/update checklist item

**Request Body:**
```json
{
  "Id": 0,
  "TaskId": 25,
  "Title": "Write unit tests",
  "Description": "Add comprehensive test coverage",
  "IsCompleted": false,
  "SortOrder": 1
}
```

#### Get Checklist
- **URL:** `POST /api/tasks/checklist`
- **Description:** Get all checklist items for task

**Request Body:**
```json
{
  "TaskId": 25
}
```

#### Delete Checklist Item
- **URL:** `POST /api/tasks/delete-checklist`
- **Description:** Delete checklist item

**Request Body:**
```json
{
  "Id": 5
}
```

### Task Activity

#### Get Activity
- **URL:** `POST /api/tasks/activity`
- **Description:** Get task activity/audit trail

**Request Body:**
```json
{
  "TaskId": 25,
  "PageNumber": 1,
  "PageSize": 20
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Task activity fetched successfully",
  "responseCode": 200,
  "data": {
    "activities": [
      {
        "id": 1,
        "taskId": 25,
        "userId": 3,
        "userName": "John Doe",
        "action": "status_changed",
        "description": "Changed status from 'To Do' to 'In Progress'",
        "oldValue": "To Do",
        "newValue": "In Progress",
        "activityDate": "2025-08-03T10:30:00.000Z"
      }
    ],
    "pagination": {
      "currentPage": 1,
      "pageSize": 20,
      "totalRecords": 15,
      "totalPages": 1
    }
  },
  "timestamp": "2025-08-03T05:30:00.000Z"
}
```

---

## Kanban Board

#### Get Kanban Columns
- **URL:** `POST /api/kanban/columns`
- **Description:** Get kanban columns with task counts

**Request Body:**
```json
{
  "ProjectId": 15
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Kanban columns fetched successfully",
  "responseCode": 200,
  "data": {
    "columns": [
      {
        "id": 1,
        "name": "To Do",
        "color": "#e74c3c",
        "sortOrder": 1,
        "taskCount": 5,
        "isActive": true
      },
      {
        "id": 2,
        "name": "In Progress",
        "color": "#f39c12",
        "sortOrder": 2,
        "taskCount": 3,
        "isActive": true
      },
      {
        "id": 3,
        "name": "Done",
        "color": "#27ae60",
        "sortOrder": 3,
        "taskCount": 8,
        "isActive": true
      }
    ]
  },
  "timestamp": "2025-08-03T05:30:00.000Z"
}
```

#### Save Kanban Column
- **URL:** `POST /api/kanban/save-column`
- **Description:** Create/update kanban column

**Request Body:**
```json
{
  "Id": 0,
  "Name": "Testing",
  "Color": "#9b59b6",
  "SortOrder": 4,
  "IsActive": true
}
```

---

## User Groups

#### Create/Update User Group
- **URL:** `POST /api/user-groups/save`
- **Description:** Create/update user group

**Request Body:**
```json
{
  "Id": 0,
  "GroupName": "Project Managers",
  "Description": "Project management team",
  "IsActive": true
}
```

#### Fetch User Groups
- **URL:** `POST /api/user-groups/fetch`
- **Description:** Get user groups with pagination

**Request Body:**
```json
{
  "Id": 0,
  "PageNumber": 1,
  "PageSize": 10,
  "SearchTerm": "manager"
}
```

#### Delete User Group
- **URL:** `POST /api/user-groups/delete`
- **Description:** Delete user group

**Request Body:**
```json
{
  "Id": 5
}
```


---

## Error Responses

All endpoints return standardized error responses:

**No Payload Error (400):**
```json
{
  "success": false,
  "message": "No payload found",
  "code": "VALIDATION_ERROR",
  "responseCode": 400,
  "data": null,
  "timestamp": "2025-08-03T05:30:00.000Z"
}
```

**Validation Error (400):**
```json
{
  "success": false,
  "message": "Validation error message",
  "code": "VALIDATION_ERROR",
  "responseCode": 400,
  "timestamp": "2025-08-03T05:30:00.000Z"
}
```

**Unauthorized (401):**
```json
{
  "success": false,
  "message": "Invalid or expired token",
  "code": "UNAUTHORIZED",
  "responseCode": 401,
  "timestamp": "2025-08-03T05:30:00.000Z"
}
```

**Forbidden (403):**
```json
{
  "success": false,
  "message": "Insufficient permissions",
  "code": "FORBIDDEN",
  "responseCode": 403,
  "timestamp": "2025-08-03T05:30:00.000Z"
}
```

**Not Found (404):**
```json
{
  "success": false,
  "message": "Resource not found",
  "code": "NOT_FOUND",
  "responseCode": 404,
  "timestamp": "2025-08-03T05:30:00.000Z"
}
```

**Server Error (500):**
```json
{
  "success": false,
  "message": "Internal server error",
  "code": "SERVER_ERROR",
  "responseCode": 500,
  "timestamp": "2025-08-03T05:30:00.000Z"
}
```

---

## Common Patterns

### Fetch Endpoint Behavior
All fetch endpoints use smart payload validation that ensures proper structure:

**Empty Request:**
```json
{}
```
**Automatically becomes:**
```json
{
  "Id": 0,
  "PageNumber": 1,
  "PageSize": 10
}
```

### Pagination
Most fetch endpoints support pagination:
```json
{
  "PageNumber": 1,
  "PageSize": 10
}
```

### Search
Most fetch endpoints support search:
```json
{
  "SearchTerm": "keyword"
}
```

### Create vs Update
- **Create:** Set `Id: 0`
- **Update:** Set `Id: <existing-id>`

### Company/Branch Isolation
Most endpoints automatically filter by the user's `CompId` and `BranchId` from the JWT token.

### JSON Arrays
For arrays (Members, Watchers, etc.), send as JSON arrays:
```json
{
  "Members": [1, 2, 3, 4],
  "Watchers": [5, 6]
}
```

---

## Utility Endpoints

#### Health Check
- **URL:** `GET /health`
- **Description:** Check API status and performance
- **Authentication:** Not required

#### Database Test
- **URL:** `GET /test-db`
- **Description:** Test database connection
- **Authentication:** Not required

#### API Information
- **URL:** `GET /api`
- **Description:** Get API information and available endpoints
- **Authentication:** Not required

---

## Security Features

1. **JWT Authentication:** All endpoints require valid tokens
2. **Role-based Access Control:** Menu-level permissions system
3. **SQL Injection Protection:** Parameterized queries only
4. **CORS Security:** Configured for specific origins
5. **Request Rate Limiting:** Prevents abuse
6. **Input Validation:** Comprehensive validation on all inputs
7. **Company/Branch Isolation:** Multi-tenant data separation

---

## Integration Notes

1. **All requests are POST-based** for consistency
2. **Always include Content-Type: application/json** header
3. **Store JWT token** securely and include in all requests
4. **Handle token expiration** gracefully with re-authentication
5. **Use pagination** for large data sets
6. **Implement proper error handling** for all response codes
7. **Follow the standardized response format** for consistent UI handling

---

**Last Updated:** August 3, 2025
**API Version:** 2.0.0