# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Testing Policy (mandatory)

**No code change in `backend/src/` ships without tests proving the changed behavior.** Applies to new features, bug fixes, and refactors.

- **New behaviour** — add tests exercising the happy path and at least one failure/edge path before the implementation is considered done.
- **Bug fixes** — write a regression test that would have failed before the fix. Flag it when reporting the fix.
- **Editing a file with no existing coverage** — add tests for the code you're about to change *first*. Leave the codebase better-tested than you found it.
- **Coverage threshold** — files you modify must reach **≥ 80%** line/branch coverage. Global floor is 60% (see `jest.config.js`).
- **Do not silence failing tests** with `.only`, `.skip`, `xit`, or `--testPathIgnorePatterns`. Fix the test or fix the code.
- **Before claiming work complete**: `npm test -- --coverage` and confirm (a) all tests pass, (b) coverage on changed files ≥ 80%.

**Test stack:** Jest + Supertest (already configured — see `jest.config.js`, `tests/setup.js`, `tests/helpers/mockRes.js`).

**Patterns already established in the codebase to reuse:**
- Pure-function tests: `tests/unit/utils/responseHelper.test.js`, `tests/unit/utils/activityLogger.test.js`.
- Middleware tests with mocked DB: `tests/unit/middleware/permission.test.js` — uses `jest.mock("../../../src/config/database")` to stub `executeStoredProcedure`. Copy this pattern for controller unit tests.
- Response doubles: `tests/helpers/mockRes.js` exports `mockRes()` returning a `res` with jest-mocked `.status()/.json()/.send()` — use this whenever you need to exercise a controller's response shape without spinning up Express.
- For HTTP-level integration tests (when needed), Supertest is installed — mount the real Express routes with the DB module mocked and assert on JSON bodies.

## Project Overview

This is a Node.js CRM (Customer Relationship Management) API built with Express.js and SQL Server. The application provides comprehensive task management, project management, team collaboration, and kanban board functionality with JWT authentication and role-based access control.

## Development Commands

### Server Management
- `npm start` - Start production server
- `npm run dev` - Start development server with nodemon
- `npm run prod` - Start production server with NODE_ENV=production

### PM2 Process Management
- `npm run pm2:start` - Start with PM2 cluster mode
- `npm run pm2:stop` - Stop PM2 process
- `npm run pm2:restart` - Restart PM2 process
- `npm run pm2:logs` - View PM2 logs
- `npm run pm2:delete` - Delete PM2 process

### Database
- No automated migrations - database schema managed externally
- Connection test available at `/test-db` endpoint

## Architecture

### Core Structure
- **Entry Point**: `src/server.js` - Main server initialization with graceful shutdown
- **Configuration**: Centralized in `src/config/` directory
  - `database.js` - SQL Server connection pool with automatic reconnection
  - `middleware.js` - Security, CORS, compression, logging setup
  - `routes.js` - API route registration and documentation generation
  - `errorHandlers.js` - Global error handling

### Database Layer
- **Technology**: SQL Server with mssql package
- **Pattern**: Singleton database class with connection pooling
- **Query Methods**: 
  - `executeQuery(query, parameters)` - Raw SQL with parameterized queries
  - `executeStoredProcedure(name, parameters)` - Stored procedure execution
- **Security**: All queries use parameterized inputs to prevent SQL injection

#### Database Schema Overview
**Core Tables:**
- `tblUser` - User accounts with roles, company/branch isolation
- `tblUserGroups` - Role-based groups (Super Admins, Project Managers, etc.)
- `tblUser_Groups` - User-to-group mapping
- `tblMenu` - Hierarchical menu system
- `tblGroupAccess` - Granular permissions (Add/Edit/Delete/View) per menu per group
- `tblTeams` - Team structure with leads
- `tblTeamMembers` - Team membership
- `tblProjects` - Projects with managers, teams, budgets, and JSON member lists
- `tblTasks` - Hierarchical tasks with parent/child relationships
- `tblTaskComments` - Task discussion threads
- `tblTaskChecklist` - Task subtasks/checklist items
- `tblTimeEntries` - Time tracking per task
- `tblTaskActivity` - Complete audit trail
- `tblKanbanColumns` - Customizable kanban board columns

#### Stored Procedure Patterns
**Database:** `eCRM+` with standard SQL Server conventions
**Structure:** All procedures use `ALTER PROC [dbo].[sp_ProcName]` format
**CRUD Operations:** Consistent pattern with @Id=0 for create, @Id>0 for update
**Response Format:** All return ResponseCode, ResponseMess, and relevant data columns
**Access Control:** Complex permission checking with JSON_VALUE for Members/Watchers arrays
**Validation:** Comprehensive input validation with descriptive error messages
**Transaction Safety:** DELETE operations wrapped in BEGIN/COMMIT TRANSACTION with error handling

**Standard Parameters:**
- `@Id` - Record identifier (BIGINT for tasks, INT for others)
- `@UserId` - Current user for permission checking
- `@CompId/@BranchId` - Multi-tenant isolation
- `@IsAdmin` - Administrative bypass flag
- `@PageNumber/@PageSize` - Pagination support
- `@SearchTerm` - Text search across relevant fields

**Permission Logic:**
- **Task Access**: Owner, Assignee, Creator, Team Member, Project Manager, or JSON Members/Watchers
- **Project Access**: Manager, Team Member, or JSON Members list
- **Company Isolation**: All queries filtered by CompId/BranchId

**Activity Logging:**
- All task modifications log to `tblTaskActivity`
- Status changes tracked with OldValue/NewValue
- Action types: 'created', 'updated', 'status_changed', 'deleted', etc.

### API Architecture
- **Authentication**: JWT-based with menu permissions system
- **Route Organization**: Feature-based modules in `src/routes/`
- **Controllers**: Business logic separated in `src/controllers/`
- **Middleware**: Auth middleware in `src/middleware/auth.js`

### Key Features
- **User Management**: Role-based access control with team assignments
- **Project Management**: Team/individual access control with hierarchical permissions
- **Task Management**: Parent/child task hierarchy with comments, time tracking, and checklists
- **Kanban Board**: Customizable columns with task organization
- **Activity Tracking**: Comprehensive audit trail for all operations

### API Endpoints Structure
All API endpoints follow POST-based pattern for consistency:
- Authentication: `/api/auth/*`
- User Management: `/api/users/*`
- Team Management: `/api/teams/*`
- Project Management: `/api/projects/*`
- Task Management: `/api/tasks/*`
- Kanban Board: `/api/kanban/*`

### Utilities
- `src/utils/responseHelper.js` - Standardized API responses and error handling
- `src/utils/encryption.js` - Cryptographic utilities

### Security Features
- Helmet for security headers
- CORS configuration for multiple origins
- Request rate limiting
- JSON parsing with size limits
- Request timeout handling (30s)
- Parameterized database queries

### Environment Configuration
- Uses `dotenv-flow` for environment-specific configs
- Supports development/production environments
- Database connection via environment variables
- Configurable server ports and base URLs

### Deployment
- PM2 ecosystem configuration in `ecosystem.config.js`
- Cluster mode with automatic restarts
- Memory limits and restart policies
- Centralized logging to `logs/` directory
- Runs on 127.0.0.1 for IIS compatibility

## Development Patterns

### Error Handling
- Global error handlers in `src/config/errorHandlers.js`
- Standardized error responses via `responseHelper.js`
- Database error categorization and handling

### Route Registration
- Dynamic route registration system
- Automatic API documentation generation
- Centralized route descriptions for HTML interface

### Database Connections
- Singleton pattern for connection management
- Automatic reconnection on failure
- Connection pooling with configurable limits
- Parameter type inference for SQL queries

### Stored Procedure Development Patterns
**File Structure:** Each procedure includes full SQL Server header with database context
```sql
USE [eCRM+]
GO
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
ALTER PROC [dbo].[sp_ProcName]
```

**Error Handling:** Consistent pattern for validation and error responses
```sql
DECLARE @ResponseCode INT;
DECLARE @ResponseMess VARCHAR(400);
-- Validation logic
IF (@Condition)
BEGIN
    SET @ResponseCode = 400;
    SET @ResponseMess = 'Error message';
    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
    RETURN;
END
```

**Complex Permission Checks:** JSON_VALUE used for array-based permissions
```sql
JSON_VALUE(p.Members, '$') LIKE '%' + CAST(@UserId AS VARCHAR) + '%'
JSON_VALUE(t.Watchers, '$') LIKE '%' + CAST(@UserId AS VARCHAR) + '%'
```

**Transaction Management:** Critical operations wrapped with proper rollback
```sql
BEGIN TRY
    BEGIN TRANSACTION;
    -- Operations
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    ROLLBACK TRANSACTION;
    -- Error handling
END CATCH
```

### Access Control Implementation
- **Company/Branch Isolation**: All data filtered by CompId/BranchId
- **Role-Based Permissions**: Menu-level granular permissions (Add/Edit/Delete/View)
- **Resource-Level Access**: Project/task access via ownership, team membership, or JSON member lists
- **Stored Procedure Security**: All procedures validate user permissions before operations

### Data Relationships
- **Hierarchical Tasks**: Parent/child task relationships with cascade restrictions
- **Team Structure**: Teams → Members → Projects → Tasks flow
- **Permission Inheritance**: Group permissions inherited by users
- **Audit Trail**: Complete activity logging for all task operations

### API Response Patterns
- **Consistent Structure**: All responses include ResponseCode, ResponseMess
- **Pagination Support**: TotalRecords, TotalPages, CurrentPage, PageSize
- **Search Integration**: SearchTerm parameter in fetch operations
- **Error Codes**: 200 (success), 201 (created), 400 (validation), 401 (auth), 403 (forbidden), 404 (not found), 409 (conflict), 500 (server error)

## Complete File Structure & Dependencies

This section maps every file, its purpose, what it imports, and where it's used. Use this as a quick reference to navigate the codebase.

### Entry Point

#### `server.js` - Application Entry Point
- **Purpose**: Server initialization, graceful shutdown, database connection test
- **Imports**:
  - `express`
  - `dotenv-flow` (environment config)
  - `config/middleware` (setupMiddleware)
  - `config/routes` (setupRoutes)
  - `config/errorHandlers` (setupErrorHandlers)
  - `config/database` (Database singleton)
- **Exports**: None (runs server)
- **Used by**: npm scripts, PM2
- **Flow**:
  1. Load environment variables
  2. Setup middleware (security, CORS, logging)
  3. Register routes
  4. Setup error handlers
  5. Test database connection
  6. Start server on 127.0.0.1:5001
  7. Register graceful shutdown handlers

### Configuration (`config/`)

#### `config/database.js` - Database Connection Manager (SINGLETON)
- **Purpose**: SQL Server connection pool, query execution
- **Imports**:
  - `mssql` (SQL Server driver)
  - `dotenv-flow`
- **Exports**: `Database` class instance (singleton)
- **Used by**:
  - server.js (connection test)
  - All controllers (query execution)
- **Methods**:
  - `testConnection()` - Verify database connectivity
  - `executeQuery(query, params)` - Raw SQL with parameters
  - `executeStoredProcedure(name, params)` - Call stored procedure
  - `close()` - Close connection pool
- **Pattern**: Singleton with lazy initialization, auto-reconnect

#### `config/middleware.js` - Middleware Configuration
- **Purpose**: Setup all Express middleware (security, logging, parsing)
- **Imports**:
  - `express`
  - `helmet` (security headers)
  - `cors`
  - `compression`
  - `morgan` (HTTP logging)
  - `express-rate-limit`
- **Exports**: `setupMiddleware(app)`
- **Used by**: server.js
- **Middleware Order**:
  1. Helmet (security headers)
  2. CORS (cross-origin requests)
  3. Compression (gzip)
  4. Morgan (request logging)
  5. JSON parser (50MB limit)
  6. URL encoded parser
  7. Rate limiting (100 req/15min)
  8. Request timeout (30s)

#### `config/routes.js` - Route Registration
- **Purpose**: Mount all API routes
- **Imports**: every `routes/*Routes` module, `utils/responseHelper`, `config/database`
- **Exports**: `setupRoutes(app)` (no return value)
- **Used by**: server.js
- **Routes Registered**:
  - `/api/auth/*`, `/api/users/*`, `/api/user-groups/*`, `/api/teams/*`, `/api/projects/*`, `/api/tasks/*`, `/api/kanban/*`, `/api/leads/*`, `/api/followups/*`, `/api/sources/*`, `/api/status/*`, `/api/reports/*`
  - `/health` - Health check (uptime/memory/env)
  - `/test-db` - Database connection test

#### `config/errorHandlers.js` - Global Error Handling
- **Purpose**: Catch-all error handlers, 404 handling
- **Imports**: None
- **Exports**: `setupErrorHandlers(app)`
- **Used by**: server.js
- **Handlers**:
  - 404 Not Found (unmatched routes)
  - General error handler (500 errors)
  - Database error handler
  - Validation error handler

### Routes (`routes/`)

#### `routes/authRoutes.js` - Authentication Routes
- **Purpose**: Login, logout, password hashing
- **Imports**:
  - `express` (Router)
  - `controllers/authController`
- **Exports**: `router`
- **Used by**: config/routes.js
- **Endpoints**:
  - `POST /loginUser` → authController.login
  - `POST /logoutUser` → authController.logout
  - `POST /hashPassword` → authController.hashPassword

#### `routes/userRoutes.js` - User Management Routes
- **Purpose**: User CRUD operations
- **Imports**:
  - `express` (Router)
  - `controllers/userController`
  - `middleware/auth` (authenticateToken)
- **Exports**: `router`
- **Used by**: config/routes.js
- **Endpoints**: (all require auth)
  - `POST /saveUser` → userController.save
  - `POST /fetchUsers` → userController.fetch
  - `POST /deleteUser` → userController.delete

#### `routes/userGroupRoutes.js` - User Group Routes
- **Purpose**: User group CRUD operations
- **Imports**:
  - `express` (Router)
  - `controllers/userGroupController`
  - `middleware/auth`
- **Exports**: `router`
- **Used by**: config/routes.js
- **Endpoints**: (all require auth)
  - `POST /saveUserGroup` → userGroupController.save
  - `POST /fetchUserGroups` → userGroupController.fetch
  - `POST /deleteUserGroup` → userGroupController.delete

#### `routes/teamRoutes.js` - Team Management Routes
- **Purpose**: Team CRUD operations
- **Imports**:
  - `express` (Router)
  - `controllers/teamController`
  - `middleware/auth`
- **Exports**: `router`
- **Used by**: config/routes.js
- **Endpoints**: (all require auth)
  - `POST /saveTeam` → teamController.save
  - `POST /fetchTeams` → teamController.fetch
  - `POST /deleteTeam` → teamController.delete

#### `routes/projectRoutes.js` - Project Management Routes
- **Purpose**: Project CRUD operations
- **Imports**:
  - `express` (Router)
  - `controllers/projectController`
  - `middleware/auth`
- **Exports**: `router`
- **Used by**: config/routes.js
- **Endpoints**: (all require auth)
  - `POST /saveProject` → projectController.save
  - `POST /fetchProjects` → projectController.fetch
  - `POST /deleteProject` → projectController.delete

#### `routes/taskRoutes.js` - Task Management Routes (LARGEST)
- **Purpose**: Task CRUD, comments, time tracking, checklist, activity
- **Imports**:
  - `express` (Router)
  - `controllers/taskController`
  - `middleware/auth`
- **Exports**: `router`
- **Used by**: config/routes.js
- **Endpoints**: (all require auth)
  - Task Operations:
    - `POST /saveTask` → taskController.save
    - `POST /fetchTasks` → taskController.fetch
    - `POST /deleteTask` → taskController.delete
    - `POST /bulkDeleteTasks` → taskController.bulkDelete
  - Comments:
    - `POST /addTaskComment` → taskController.addComment
    - `POST /getTaskComments` → taskController.getComments
    - `POST /deleteTaskComment` → taskController.deleteComment
  - Time Tracking:
    - `POST /logTaskTime` → taskController.logTime
    - `POST /getTaskTimeEntries` → taskController.getTimeEntries
    - `POST /deleteTaskTimeEntry` → taskController.deleteTimeEntry
  - Checklist:
    - `POST /saveTaskChecklist` → taskController.saveChecklist
    - `POST /getTaskChecklist` → taskController.getChecklist
    - `POST /deleteTaskChecklist` → taskController.deleteChecklist
  - Activity:
    - `POST /getTaskActivity` → taskController.getActivity

#### `routes/kanbanRoutes.js` - Kanban Board Routes
- **Purpose**: Kanban column CRUD operations
- **Imports**:
  - `express` (Router)
  - `controllers/kanbanController`
  - `middleware/auth`
- **Exports**: `router`
- **Used by**: config/routes.js
- **Endpoints**: (all require auth)
  - `POST /saveKanbanColumn` → kanbanController.save
  - `POST /fetchKanbanColumns` → kanbanController.fetch
  - `POST /deleteKanbanColumn` → kanbanController.delete

### Controllers (`controllers/`)

#### `controllers/authController.js` - Authentication Logic
- **Purpose**: User login, JWT generation, password hashing
- **Imports**:
  - `config/database`
  - `bcryptjs` (password hashing)
  - `jsonwebtoken` (JWT creation)
  - `utils/responseHelper`
- **Exports**: `authController` object
- **Used by**: routes/authRoutes.js
- **Methods**:
  - `login(req, res)` - Validates credentials, generates JWT
    - Calls: `sp_UserLogin`
    - Returns: token, user, company, permissions
  - `logout(req, res)` - Clears session (placeholder)
  - `hashPassword(req, res)` - Generates bcrypt hash for passwords
- **Key Logic**:
  - Password comparison with bcrypt
  - JWT creation with 24h expiry
  - Menu permissions included in token payload

#### `controllers/userController.js` - User Management Logic
- **Purpose**: User CRUD operations with permissions
- **Imports**:
  - `config/database`
  - `utils/responseHelper`
- **Exports**: `userController` object
- **Used by**: routes/userRoutes.js
- **Methods**:
  - `save(req, res)` - Create/update user
    - Calls: `sp_SaveUser`
    - Params: Id, Username, FullName, Email, Password, UserGroupId, TeamId, CompId, BranchId
  - `fetch(req, res)` - Get users with pagination
    - Calls: `sp_FetchUsers`
    - Params: Id, PageNumber, PageSize, SearchTerm, CompId, BranchId
  - `delete(req, res)` - Delete user
    - Calls: `sp_DeleteUser`
    - Params: Id, CompId, BranchId

#### `controllers/userGroupController.js` - User Group Logic
- **Purpose**: User group CRUD operations
- **Imports**:
  - `config/database`
  - `utils/responseHelper`
- **Exports**: `userGroupController` object
- **Used by**: routes/userGroupRoutes.js
- **Methods**:
  - `save(req, res)` - Create/update user group
    - Calls: `sp_SaveUserGroup`
  - `fetch(req, res)` - Get user groups with pagination
    - Calls: `sp_FetchUserGroups`
  - `delete(req, res)` - Delete user group
    - Calls: `sp_DeleteUserGroup`

#### `controllers/teamController.js` - Team Management Logic
- **Purpose**: Team CRUD operations with member management
- **Imports**:
  - `config/database`
  - `utils/responseHelper`
- **Exports**: `teamController` object
- **Used by**: routes/teamRoutes.js
- **Methods**:
  - `save(req, res)` - Create/update team with members
    - Calls: `sp_SaveTeam`
    - Params: Id, TeamName, TeamLeadUserId, Members (JSON array), CompId, BranchId
  - `fetch(req, res)` - Get teams with members
    - Calls: `sp_FetchTeams`
  - `delete(req, res)` - Delete team
    - Calls: `sp_DeleteTeam`

#### `controllers/projectController.js` - Project Management Logic
- **Purpose**: Project CRUD operations with access control
- **Imports**:
  - `config/database`
  - `utils/responseHelper`
- **Exports**: `projectController` object
- **Used by**: routes/projectRoutes.js
- **Methods**:
  - `save(req, res)` - Create/update project
    - Calls: `sp_SaveProject`
    - Params: Id, ProjectName, Description, ManagerUserId, TeamId, Members (JSON), Budget, StartDate, EndDate, CompId, BranchId
  - `fetch(req, res)` - Get projects (filtered by access)
    - Calls: `sp_FetchProjects`
    - Access Control: Only returns projects user can access
  - `delete(req, res)` - Delete project
    - Calls: `sp_DeleteProject`

#### `controllers/taskController.js` - Task Management Logic (LARGEST)
- **Purpose**: Comprehensive task operations
- **Imports**:
  - `config/database`
  - `utils/responseHelper`
- **Exports**: `taskController` object
- **Used by**: routes/taskRoutes.js
- **Methods**:
  - Task CRUD:
    - `save(req, res)` - Create/update task
      - Calls: `sp_SaveTask`
      - Params: Id, Title, Description, ProjectId, ParentTaskId, AssignedToUserId, TeamId, Priority, Type, Status, DueDate, EstimatedHours, LoggedHours, Progress, IsBlocked, Labels, Watchers, Dependencies (JSON arrays)
    - `fetch(req, res)` - Get tasks with filters
      - Calls: `sp_FetchTask`
      - Params: Id, ProjectId, UserId, PageNumber, PageSize, SearchTerm
    - `delete(req, res)` - Delete single task
      - Calls: `sp_DeleteTask`
    - `bulkDelete(req, res)` - Delete multiple tasks
      - Calls: `sp_BulkDeleteTasks`
      - Params: TaskIds (array)
  - Comments:
    - `addComment(req, res)` - Add comment to task
      - Calls: `sp_AddTaskComment`
    - `getComments(req, res)` - Get task comments
      - Calls: `sp_GetTaskComments`
    - `deleteComment(req, res)` - Delete comment
      - Calls: `sp_DeleteTaskComment`
  - Time Tracking:
    - `logTime(req, res)` - Log time entry
      - Calls: `sp_LogTaskTime`
      - Params: TaskId, UserId, Hours, Description, LogDate
    - `getTimeEntries(req, res)` - Get time entries
      - Calls: `sp_GetTaskTimeEntries`
    - `deleteTimeEntry(req, res)` - Delete time entry
      - Calls: `sp_DeleteTaskTimeEntry`
  - Checklist:
    - `saveChecklist(req, res)` - Create/update checklist item
      - Calls: `sp_SaveTaskChecklist`
    - `getChecklist(req, res)` - Get checklist items
      - Calls: `sp_GetTaskChecklist`
    - `deleteChecklist(req, res)` - Delete checklist item
      - Calls: `sp_DeleteTaskChecklist`
  - Activity:
    - `getActivity(req, res)` - Get task audit trail
      - Calls: `sp_GetTaskActivity`

#### `controllers/kanbanController.js` - Kanban Board Logic
- **Purpose**: Kanban column CRUD operations
- **Imports**:
  - `config/database`
  - `utils/responseHelper`
- **Exports**: `kanbanController` object
- **Used by**: routes/kanbanRoutes.js
- **Methods**:
  - `save(req, res)` - Create/update kanban column
    - Calls: `sp_SaveKanbanColumn`
    - Params: Id, ColumnName, ColumnOrder, Color, CompId, BranchId
  - `fetch(req, res)` - Get kanban columns with task counts
    - Calls: `sp_FetchKanbanColumns`
  - `delete(req, res)` - Delete kanban column
    - Calls: `sp_DeleteKanbanColumn`

### Middleware (`middleware/`)

#### `middleware/auth.js` - JWT Authentication Middleware
- **Purpose**: Validate JWT tokens, extract user info
- **Imports**:
  - `jsonwebtoken`
- **Exports**: `authenticateToken` middleware function
- **Used by**: All protected routes (in routes/*.js)
- **Logic**:
  - Extract Bearer token from Authorization header
  - Verify JWT signature
  - Decode payload
  - Attach user info to req.user
  - Return 401 if invalid/missing token
- **req.user Properties**:
  - UserId, CompId, BranchId, IsAdmin, Username, FullName, Email

#### `middleware/payloadValidation.js` - Request Validation
- **Purpose**: Validate request payloads (currently minimal)
- **Imports**: None
- **Exports**: Validation middleware functions
- **Used by**: Not currently in use (future feature)

### Utilities (`utils/`)

#### `utils/responseHelper.js` - Standardized API Responses
- **Purpose**: Consistent response formatting, error handling
- **Imports**: None
- **Exports**:
  - `success(res, message, data, code)` - Success response
  - `error(res, message, code)` - Error response
  - `validationError(res, errors)` - Validation error (400)
  - `unauthorizedError(res, message)` - Auth error (401)
  - `forbiddenError(res, message)` - Permission error (403)
  - `notFoundError(res, message)` - Not found (404)
  - `conflictError(res, message)` - Conflict (409)
  - `dbErrors` object:
    - `connectionFailed(res)`
    - `queryFailed(res, error)`
    - `deadlock(res)`
    - `timeout(res)`
    - `constraintViolation(res, error)`
- **Used by**:
  - All controllers
  - config/routes.js (health check, test-db)
  - config/errorHandlers.js
- **Response Format**:
  ```json
  {
    "success": true/false,
    "message": "...",
    "code": "...",
    "responseCode": 200,
    "data": {...},
    "timestamp": "2025-08-03T08:23:11.705Z"
  }
  ```

#### `utils/encryption.js` - Cryptographic Utilities
- **Purpose**: Encryption/decryption helpers (currently minimal)
- **Imports**: `crypto`
- **Exports**: Encryption functions
- **Used by**: Future feature (not currently in use)

## Quick Navigation Guide

### "I want to add a new API endpoint"
1. Create controller method in `controllers/[feature]Controller.js`
2. Call stored procedure via `database.executeStoredProcedure()`
3. Use `responseHelper` for standardized responses
4. Add route in `routes/[feature]Routes.js`
5. Register route in `config/routes.js`

### "I want to modify authentication"
→ `controllers/authController.js` - Login logic, JWT generation
→ `middleware/auth.js` - Token validation
→ Stored Procedure: `sp_UserLogin`

### "I want to add/modify stored procedures"
1. Create SQL file with proper header (USE [eCRM+], etc.)
2. Follow naming convention: `sp_[Action][Entity]` (e.g., `sp_SaveTask`)
3. Include standard parameters (@Id, @UserId, @CompId, @BranchId)
4. Return ResponseCode, ResponseMess
5. Add permission checks (CompId/BranchId filtering)
6. Log to tblTaskActivity if applicable
7. Call from controller via `database.executeStoredProcedure()`

### "I want to modify task management"
→ `controllers/taskController.js` - Task business logic
→ `routes/taskRoutes.js` - Task endpoints
→ Stored Procedures: `sp_SaveTask`, `sp_FetchTask`, `sp_DeleteTask`, etc.
→ Database Tables: tblTasks, tblTaskComments, tblTaskChecklist, tblTimeEntries, tblTaskActivity

### "I want to add middleware"
→ `config/middleware.js` - Global middleware
→ `middleware/` - Custom middleware (auth, validation)
→ Register in `setupMiddleware()` function

### "I want to modify database connection"
→ `config/database.js` - Connection pool, query methods
→ `.env` file - DB_SERVER, DB_NAME, DB_USER, DB_PASSWORD

### "I want to add error handling"
→ `utils/responseHelper.js` - Response helpers
→ `config/errorHandlers.js` - Global error handlers
→ Use try/catch in controllers

### "I want to understand the data flow"
1. Request → `server.js` → middleware
2. Middleware → `config/middleware.js` (security, auth)
3. Auth → `middleware/auth.js` (JWT validation)
4. Route → `routes/*.js` (endpoint mapping)
5. Controller → `controllers/*.js` (business logic)
6. Database → `config/database.js` → Stored Procedure
7. Response → `utils/responseHelper.js` → Client

### "I want to modify security settings"
→ `config/middleware.js` - Helmet, CORS, rate limiting
→ `middleware/auth.js` - JWT validation
→ All stored procedures - CompId/BranchId filtering

### "I want to modify response format"
→ `utils/responseHelper.js` - All response functions
→ Controllers - Use responseHelper methods
→ Stored Procedures - ResponseCode, ResponseMess pattern