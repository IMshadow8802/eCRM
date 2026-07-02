# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Testing Policy (mandatory)

**No code change in `web/src/` ships without tests proving the changed behavior.** Applies to new features, bug fixes, and refactors.

- **New behaviour** — add tests exercising the happy path and at least one failure/edge path before the implementation is considered done.
- **Bug fixes** — write a regression test that would have failed before the fix. Flag it when reporting the fix.
- **Editing a file with no existing coverage** — add tests for the code you're about to change *first*. Leave the codebase better-tested than you found it.
- **Coverage threshold** — files you modify must reach **≥ 80%** line/branch coverage. Global floor is 60% (see `vitest.config.js`).
- **Do not silence failing tests** with `.only`, `.skip`, `xit`, or by excluding them from `include`/`exclude`. Fix the test or fix the code.
- **Before claiming work complete**: `npm test -- --coverage` and confirm (a) all tests pass, (b) coverage on changed files ≥ 80%.

**Test stack:** Vitest + React Testing Library + MSW (already configured — see `vitest.config.js`, `src/test/setup.js`, `src/test/mocks/handlers.js`).

**Patterns already established in the codebase to reuse:**
- Pure-function tests: `src/stores/useAuthStore.test.js` (`hasPermission`).
- Component render tests with MUI + Router: `src/components/TopNav.test.jsx`, `src/components/Sidebar.test.jsx`. Use the `setMatchMedia` helper in those files when testing responsive branches; both mock `useAuthStore`, `useThemeStore`, `useApi`, and `notistack` with `vi.mock`.
- MSW handlers live in `src/test/mocks/handlers.js` — add a handler there before writing any test that makes a real API call.

## Common Commands

### Development
- `npm run dev` - Start development server on port 8080
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint for code quality checks

### Building
- `pnpm build` - Build for web deployment (outputs to `dist-web/`)
- `pnpm clean` - Remove the build directory

## Architecture Overview

Web-only React SPA deployed to the `/eStockCRM/` path. No desktop/Electron build — that was removed.

### Key Technologies
- **Frontend**: React 19 + Vite
- **UI Libraries**: Material-UI v9, Material-Tailwind, Heroicons, lucide-react
- **State Management**: Zustand stores (auth, tasks, kanban, etc.)
- **API Client**: Axios with interceptors
- **Forms**: React Hook Form + Zod validation
- **Routing**: React Router v7 with `BrowserRouter` (basename `/eStockCRM/`)
- **Drag & Drop**: `@dnd-kit/react` for kanban boards
- **Charts**: recharts for data visualization

### Core Architecture Patterns

#### State Management with Zustand
- `zustand/useAuthStore.js` - Authentication, user data, permissions
- `zustand/useTaskStore.js` - Task management state
- `zustand/useKanbanStore.js` - Kanban board state
- All stores use `persist` middleware for localStorage

#### API Layer Structure
- `src/api/axios.js` - Base Axios instance with auth interceptors
- `src/api/masterQueries/` - API queries organized by domain
- API base URL from auth store: `https://prdinfotech.in/CRM`
- Automatic token injection and 401 handling

#### Routing
- `BrowserRouter` with `basename="/eStockCRM/"`
- All API redirects (401, session expiry) go through `utils/redirectToLogin.js` which prepends the same base via `import.meta.env.BASE_URL`

#### Module Organization
- `src/pages/` - Route components organized by feature area
- `src/components/` - Reusable UI components
- `src/hooks/` - Custom React hooks
- `src/utils/` - Utility functions

### Key Features
- **Masters Management**: Leads, Contacts, Complaints, Lead Status
- **Task Management**: Full CRUD with drag-and-drop kanban interface
- **Dashboard**: Statistics and charts
- **Authentication**: JWT-based with permissions system
- **Responsive Design**: Mobile-friendly with responsive breakpoints

### Development Notes
- Development server runs on port 8080
- React Query DevTools available in development
- ESLint configured for React/JSX

### API Response Patterns
All fetch API responses follow this consistent structure:

```json
{
  "success": true,
  "message": "Resource retrieved successfully", 
  "responseCode": 200,
  "data": {
    "resourceName": [...], // The actual data array
    "pagination": {
      "currentPage": 1,
      "pageSize": 10,
      "totalRecords": 25,
      "totalPages": 3
    }
  },
  "timestamp": "2025-08-03T08:23:11.705Z"
}
```

**Important:** When using `useApiQuery`, always extract data from `responseData?.resourceName` where `resourceName` matches the API endpoint (e.g., `users`, `userGroups`, `teams`, `projects`, etc.).

## Complete File Structure & Dependencies

This section maps every file, its purpose, what it imports, and where it's used. Use this as a quick reference to navigate the codebase.

### Entry Points

#### `main.jsx` - Application Entry Point
- **Purpose**: React app initialization, provider setup
- **Imports**:
  - `React`, `ReactDOM` from react
  - `App.jsx`
  - `theme.js` (MUI custom theme)
  - `@tanstack/react-query` (QueryClient, QueryClientProvider)
  - `@tanstack/react-query-devtools` (ReactQueryDevtools)
- **Exports**: None (renders to DOM)
- **Used by**: index.html
- **Key setup**: React Query config (5min stale time, 10min cache), MUI ThemeProvider, DevTools

#### `App.jsx` - Router Configuration
- **Purpose**: Main routing
- **Imports**:
  - `SnackbarProvider` from notistack
  - `HelmetProvider` from react-helmet-async
  - `BrowserRouter`, `Routes`, `Route`, `Navigate` from react-router-dom
  - `ProtectedRoute` from ./components/ProtectedRoutes
  - `RootLayout` from ./components/RootLayout
  - `SessionMonitor` from ./components/SessionMonitor
  - All page components (lazy loaded)
- **Exports**: `App` component
- **Used by**: main.jsx
- **Routes**: /, /login, /dashboard/*, /tasks/*, /projects/*, /teams/*, /users/*

### State Management (`stores/`)

#### `stores/useAuthStore.js` - Authentication State (PRIMARY STORE)
- **Purpose**: User auth, permissions, token management, API base URL
- **Imports**:
  - `create` from zustand
  - `persist`, `createJSONStorage` from zustand/middleware
  - `getTokenRemainingTime`, `isTokenExpired`, `isTokenExpiringSoon`, `validateToken` from ../utils/tokenUtils
- **Exports**: `useAuthStore` (default)
- **Used by**:
  - App.jsx (session management)
  - RootLayout.jsx (sidebar visibility)
  - ProtectedRoutes.jsx (auth guard)
  - SessionMonitor.jsx (token monitoring)
  - All pages (user data, permissions)
  - api/axios.js (API base URL, token)
  - hooks/useApiQuery.jsx (auth headers)
- **State**: isAuthenticated, token, user, company, permissions, BranchId, CompId, UserId, API_BASE_URL, menuRights
- **Methods**: login(), logout(), logoutWithApi(), toggleSidebar(), hasPermission(), checkTokenExpiry(), forceLogout()

#### `stores/useTaskStore.js` - Task Management State
- **Purpose**: Task CRUD state, filters, selected tasks
- **Imports**: `create` from zustand, `persist` from zustand/middleware
- **Exports**: `useTaskStore` (default)
- **Used by**: pages/Task/*.jsx
- **State**: tasks, selectedTask, filters
- **Methods**: setTasks(), selectTask(), updateFilters()

### Core Components (`components/`)

#### `components/RootLayout.jsx` - Application Shell
- **Purpose**: Main layout wrapper with sidebar
- **Imports**:
  - `Sidebar` from ./Sidebar
  - `useAuthStore` from ../stores/useAuthStore
- **Exports**: `RootLayout` component (default)
- **Used by**: App.jsx (wraps all routes)
- **Logic**: Conditionally shows Sidebar based on auth and isOpen state

#### `components/ProtectedRoutes.jsx` - Auth Guard
- **Purpose**: Route protection, redirects to login if not authenticated
- **Imports**:
  - `Navigate` from react-router-dom
  - `useAuthStore` from ../stores/useAuthStore
- **Exports**: `ProtectedRoute` component (default)
- **Used by**: App.jsx (wraps protected routes)
- **Logic**: Checks isAuthenticated, redirects to /login if false

#### `components/SessionMonitor.jsx` - Token Expiry Monitoring
- **Purpose**: Auto-logout, token expiry warnings
- **Imports**:
  - `useTokenMonitor` from ../hooks/useTokenMonitor
  - `useNetworkMonitor` from ../hooks/useNetworkMonitor
  - `NetworkStatusBanner` from ./NetworkStatusBanner
  - `useAuthStore` from ../stores/useAuthStore
  - `enqueueSnackbar` from notistack
- **Exports**: `SessionMonitor` component (default)
- **Used by**: App.jsx (wraps entire app)
- **Logic**: Monitors token expiry, shows warnings, auto-logout when expired

#### `components/Sidebar.jsx` - Navigation Sidebar
- **Purpose**: Main navigation menu with permissions-based rendering
- **Imports**:
  - `useAuthStore` from ../stores/useAuthStore
  - `useNavigate` from react-router-dom
  - Various icons from @heroicons/react
- **Exports**: `Sidebar` component (default)
- **Used by**: RootLayout.jsx
- **Logic**: Renders menu items based on user permissions (menuRights)

#### `components/Navbar.jsx` - Top Navigation Bar
- **Purpose**: Header with user info, notifications, logout
- **Imports**:
  - `useAuthStore` from ../stores/useAuthStore
  - Various MUI components
- **Exports**: `Navbar` component (default)
- **Used by**: pages/* (various pages)

#### `components/Dashboard.jsx` - Dashboard Page
- **Purpose**: Main dashboard with stats and charts
- **Imports**:
  - `StatCard` from ./StatCard
  - Chart components from ./Charts/*
  - `useApiQuery` from ../hooks/useApiQuery
  - `useAuthStore` from ../stores/useAuthStore
- **Exports**: `Dashboard` component (default)
- **Used by**: App.jsx (route /dashboard)
- **API Calls**: Fetches dashboard statistics

### Custom Hooks (`hooks/`)

#### `hooks/useApiQuery.jsx` - Generic API Query Hook
- **Purpose**: Standardized data fetching with React Query, error handling, notifications
- **Imports**:
  - `useQuery` from @tanstack/react-query
  - `enqueueSnackbar` from notistack
  - `apiClient` from ../utils/axiosConfig
  - `processApiResponse` from ../utils/apiUtils
- **Exports**: `useApiQuery`, `useManualApiQuery`
- **Used by**: All pages (Dashboard, Tasks, Projects, Teams, Users, Kanban)
- **Features**: Auto error handling, success notifications, cache management, empty data handling

#### `hooks/useApiMutation.jsx` - Generic API Mutation Hook
- **Purpose**: Standardized data mutations (POST/PUT/DELETE)
- **Imports**:
  - `useMutation` from @tanstack/react-query
  - `apiClient` from ../utils/axiosConfig
  - `enqueueSnackbar` from notistack
- **Exports**: `useApiMutation`
- **Used by**: Form components, modal components
- **Features**: Auto success/error notifications, optimistic updates, cache invalidation

#### `hooks/useTokenMonitor.jsx` - Token Expiry Monitoring
- **Purpose**: Monitors JWT token expiry, triggers warnings
- **Imports**: `useAuthStore` from ../stores/useAuthStore
- **Exports**: `useTokenMonitor`
- **Used by**: SessionMonitor.jsx
- **Logic**: Checks token every minute, calculates remaining time

#### `hooks/useNetworkMonitor.js` - Network Status Monitoring
- **Purpose**: Detects online/offline status
- **Imports**: None (uses navigator.onLine)
- **Exports**: `useNetworkMonitor`
- **Used by**: SessionMonitor.jsx
- **Logic**: Listens to online/offline events

#### `hooks/useConfirmation.jsx` - Confirmation Dialog Hook
- **Purpose**: Reusable confirmation dialogs
- **Imports**:
  - `ConfirmationDialog` from ../components/ConfirmationDialog
- **Exports**: `useConfirmation`
- **Used by**: Delete operations across all pages
- **Logic**: Returns confirm() method and ConfirmationDialog component

#### `hooks/useTaskData.jsx` - Task Data Management
- **Purpose**: Task fetching logic with filters
- **Imports**:
  - `useApiQuery` from ./useApiQuery
  - `useAuthStore` from ../stores/useAuthStore
- **Exports**: `useTaskData`
- **Used by**: pages/Task/*.jsx
- **Logic**: Fetches tasks with pagination and filters

### API Layer (`api/` and `utils/`)

#### `utils/axiosConfig.js` - Axios Instance with Interceptors
- **Purpose**: Configured Axios client with auth injection, error handling
- **Imports**:
  - `axios` from axios
  - `useAuthStore` from ../stores/useAuthStore
- **Exports**: `apiClient`
- **Used by**:
  - hooks/useApiQuery.jsx
  - hooks/useApiMutation.jsx
  - All API service functions
- **Interceptors**:
  - Request: Injects Authorization Bearer token
  - Response: Handles 401 (auto logout), 403, 500 errors

#### `api/axios.js` - Legacy Axios Config (alias)
- **Purpose**: Same as axiosConfig.js
- **Imports/Exports**: Same as axiosConfig.js
- **Used by**: Older components (being migrated to axiosConfig.js)

#### `utils/apiUtils.js` - API Response Processing
- **Purpose**: Handles "No data found" responses, cleans empty arrays
- **Imports**: None
- **Exports**: `processApiResponse`
- **Used by**: hooks/useApiQuery.jsx
- **Logic**: Converts null data to empty arrays for consistent rendering

#### `utils/tokenUtils.js` - JWT Token Utilities
- **Purpose**: Token validation, expiry checking
- **Imports**: None (uses jwt-decode logic)
- **Exports**: `isTokenExpired`, `isTokenExpiringSoon`, `getTokenRemainingTime`, `validateToken`
- **Used by**:
  - stores/useAuthStore.js
  - hooks/useTokenMonitor.jsx
- **Logic**: Decodes JWT, checks expiry timestamp

#### `utils/redirectToLogin.js` - Login redirect helper
- **Purpose**: Build the login URL with Vite's `import.meta.env.BASE_URL` so 401 redirects respect the `/eStockCRM/` base.
- **Exports**: `getLoginUrl()`, `redirectToLogin()`
- **Used by**: `utils/axiosConfig.js`, `hooks/useApi.js`, `api/axios.js`

#### `utils/authRedirectGuard.js` - Skip auto-logout for auth endpoints
- **Purpose**: Tells the 401 interceptors to NOT logout + redirect when the failing request is `/api/auth/loginUser` / `logoutUser` / `hashPassword`. Lets bad-credentials toasts surface.
- **Exports**: `shouldSkipAuthRedirect(url)`

### Pages (`pages/`)

#### `pages/auth/Login.jsx` - Login Page
- **Purpose**: User authentication form
- **Imports**:
  - `useAuthStore` from ../../stores/useAuthStore
  - `useNavigate` from react-router-dom
  - `apiClient` from ../../utils/axiosConfig
  - Form components from ../../components/Design/FormComponents
- **Exports**: `Login` component (default)
- **Used by**: App.jsx (route /login)
- **API Calls**: POST /api/auth/loginUser
- **Logic**: Form submission, token storage, redirect to dashboard

#### `pages/Master/Projects.jsx` - Projects Management
- **Purpose**: CRUD operations for projects
- **Imports**:
  - `useApiQuery` from ../../hooks/useApiQuery
  - `useApiMutation` from ../../hooks/useApiMutation
  - `useAuthStore` from ../../stores/useAuthStore
  - `ProjectForm` from ./components/ProjectForm
  - `material-react-table` (MRT)
- **Exports**: `Projects` component (default)
- **Used by**: App.jsx (route /projects/*)
- **API Calls**:
  - POST /api/projects/fetchProjects
  - POST /api/projects/saveProject
  - POST /api/projects/deleteProject

#### `pages/Master/Teams.jsx` - Teams Management
- **Purpose**: CRUD operations for teams
- **Imports**:
  - `useApiQuery`, `useApiMutation`
  - `useAuthStore`
  - `TeamForm` from ./components/TeamForm
  - `material-react-table`
- **Exports**: `Teams` component (default)
- **Used by**: App.jsx (route /teams/*)
- **API Calls**:
  - POST /api/teams/fetchTeams
  - POST /api/teams/saveTeam
  - POST /api/teams/deleteTeam

#### `pages/Master/Users.jsx` - Users Management
- **Purpose**: CRUD operations for users
- **Imports**:
  - `useApiQuery`, `useApiMutation`
  - `useAuthStore`
  - `UserForm` from ./components/UserForm
  - `material-react-table`
- **Exports**: `Users` component (default)
- **Used by**: App.jsx (route /users/*)
- **API Calls**:
  - POST /api/users/fetchUsers
  - POST /api/users/saveUser
  - POST /api/users/deleteUser

#### `pages/Master/Kanban.jsx` - Kanban Columns Management
- **Purpose**: Configure kanban board columns
- **Imports**:
  - `useApiQuery`, `useApiMutation`
  - `useAuthStore`
  - `KanbanForm` from ./components/KanbanForm
  - `material-react-table`
- **Exports**: `KanbanColumns` component (default)
- **Used by**: App.jsx (route /kanban_columns/*)
- **API Calls**:
  - POST /api/kanban/fetchKanbanColumns
  - POST /api/kanban/saveKanbanColumn
  - POST /api/kanban/deleteKanbanColumn

#### `pages/Task/Task.jsx` - Task Management Main View
- **Purpose**: Task list, kanban board, CRUD operations
- **Imports**:
  - `useTaskStore` from ../../stores/useTaskStore
  - `useTaskData` from ../../hooks/useTaskData
  - `useApiMutation` from ../../hooks/useApiMutation
  - `CreateTaskModal` from ./Components/CreateTaskModal
  - `TaskModal` from ./Components/TaskModal
  - `material-react-table`, `@dnd-kit` (drag-drop)
- **Exports**: `Task` component (default)
- **Used by**: App.jsx (route /tasks/*)
- **API Calls**:
  - POST /api/tasks/fetchTasks
  - POST /api/tasks/saveTask
  - POST /api/tasks/deleteTask
  - POST /api/tasks/bulkDeleteTasks

#### `pages/NotFound.jsx` - 404 Page
- **Purpose**: Error page for unknown routes
- **Imports**: None
- **Exports**: `NotFound` component (default)
- **Used by**: App.jsx (catch-all route)

### Form Components (`pages/Master/components/`)

#### `pages/Master/components/ProjectForm.jsx`
- **Purpose**: Project creation/editing form
- **Imports**:
  - `useForm` from react-hook-form
  - `zodResolver` from @hookform/resolvers/zod
  - `zod` for validation
  - Form components from ../../../components/Design/FormComponents
- **Exports**: `ProjectForm` component
- **Used by**: pages/Master/Projects.jsx
- **Props**: project (edit mode), onSubmit, onClose

#### `pages/Master/components/TeamForm.jsx`
- **Purpose**: Team creation/editing form
- **Imports**: Same as ProjectForm
- **Exports**: `TeamForm` component
- **Used by**: pages/Master/Teams.jsx
- **Props**: team (edit mode), onSubmit, onClose

#### `pages/Master/components/UserForm.jsx`
- **Purpose**: User creation/editing form
- **Imports**: Same as ProjectForm
- **Exports**: `UserForm` component
- **Used by**: pages/Master/Users.jsx
- **Props**: user (edit mode), onSubmit, onClose

#### `pages/Master/components/KanbanForm.jsx`
- **Purpose**: Kanban column creation/editing form
- **Imports**: Same as ProjectForm
- **Exports**: `KanbanForm` component
- **Used by**: pages/Master/Kanban.jsx
- **Props**: column (edit mode), onSubmit, onClose

### Task Components (`pages/Task/Components/`)

#### `pages/Task/Components/CreateTaskModal.jsx`
- **Purpose**: Task creation modal
- **Imports**:
  - `useForm` from react-hook-form
  - `useAuthStore`
  - Form components
- **Exports**: `CreateTaskModal` component
- **Used by**: pages/Task/Task.jsx
- **Props**: open, onClose, onSubmit

#### `pages/Task/Components/TaskModal.jsx`
- **Purpose**: Task view/edit modal with comments, time tracking
- **Imports**:
  - `useApiQuery`, `useApiMutation`
  - `useAuthStore`
  - Form components
- **Exports**: `TaskModal` component
- **Used by**: pages/Task/Task.jsx
- **Props**: taskId, open, onClose
- **API Calls**:
  - GET task details
  - POST task comments
  - POST time entries
  - POST checklist items

### UI Components (`components/`)

#### `components/Design/FormComponents.jsx`
- **Purpose**: Reusable form inputs (TextField, SelectField, DateField, etc.)
- **Imports**: MUI components
- **Exports**: TextField, SelectField, DateField, TextAreaField, CheckboxField, etc.
- **Used by**: All form components
- **Features**: Integrated validation, error messages, Material-UI styling

#### `components/Design/CustomButton.jsx`
- **Purpose**: Styled button component
- **Imports**: MUI Button
- **Exports**: `CustomButton` component
- **Used by**: Forms, modals, action buttons

#### `components/Design/ActionButton.jsx`
- **Purpose**: Action button with loading state
- **Imports**: MUI IconButton, CircularProgress
- **Exports**: `ActionButton` component
- **Used by**: Table rows (edit, delete)

#### `components/ConfirmationDialog.jsx`
- **Purpose**: Confirmation dialog for destructive actions
- **Imports**: MUI Dialog components
- **Exports**: `ConfirmationDialog` component
- **Used by**: hooks/useConfirmation.jsx
- **Props**: open, title, message, onConfirm, onCancel

#### `components/StatCard.jsx`
- **Purpose**: Dashboard statistics card
- **Imports**: MUI Card components
- **Exports**: `StatCard` component
- **Used by**: components/Dashboard.jsx
- **Props**: title, value, icon, trend

#### `components/NetworkStatusBanner.jsx`
- **Purpose**: Shows offline/online status banner
- **Imports**: MUI Alert
- **Exports**: `NetworkStatusBanner` component
- **Used by**: components/SessionMonitor.jsx
- **Props**: isOnline

### Chart Components (`components/Charts/`)

#### `components/Charts/PieChart.jsx`
- **Purpose**: Pie chart using ECharts
- **Imports**: `echarts`, `echarts-for-react`
- **Exports**: `PieChart` component
- **Used by**: components/Dashboard.jsx
- **Props**: data, title

#### `components/Charts/LineChart.jsx`
- **Purpose**: Line chart using ECharts
- **Imports**: `echarts`, `echarts-for-react`
- **Exports**: `LineChart` component
- **Used by**: components/Dashboard.jsx
- **Props**: data, title

#### `components/Charts/CircleBarChart.jsx`
- **Purpose**: Circular bar chart using ECharts
- **Imports**: `echarts`, `echarts-for-react`
- **Exports**: `CircleBarChart` component
- **Used by**: components/Dashboard.jsx
- **Props**: data, title

#### `components/Charts/FunnelChart.jsx`
- **Purpose**: Funnel chart using ECharts
- **Imports**: `echarts`, `echarts-for-react`
- **Exports**: `FunnelChart` component
- **Used by**: components/Dashboard.jsx
- **Props**: data, title

#### `components/Charts/NightangleChart.jsx`
- **Purpose**: Nightingale rose chart using ECharts
- **Imports**: `echarts`, `echarts-for-react`
- **Exports**: `NightangleChart` component
- **Used by**: components/Dashboard.jsx
- **Props**: data, title

### Utilities

#### `theme.js` - MUI Custom Theme
- **Purpose**: Material-UI theme configuration
- **Imports**: `createTheme` from @mui/material/styles
- **Exports**: `customTheme` (default)
- **Used by**: main.jsx (ThemeProvider)
- **Config**: Primary colors, typography, component overrides

#### `Data.js` - Static Data/Constants
- **Purpose**: Menu items, static configurations
- **Imports**: None
- **Exports**: Various data constants
- **Used by**: components/Sidebar.jsx, form components

#### `data/statisticsCardData.js` - Dashboard Card Data
- **Purpose**: Dashboard statistics card configurations
- **Imports**: None
- **Exports**: Card data array
- **Used by**: components/Dashboard.jsx

## Quick Navigation Guide

### "I want to modify authentication"
→ `stores/useAuthStore.js` - Auth state
→ `pages/auth/Login.jsx` - Login UI
→ `utils/axiosConfig.js` - API token injection
→ `components/SessionMonitor.jsx` - Token monitoring

### "I want to add a new API endpoint"
→ `hooks/useApiQuery.jsx` - For GET operations
→ `hooks/useApiMutation.jsx` - For POST/PUT/DELETE
→ `utils/axiosConfig.js` - May need to update interceptors

### "I want to add a new page/route"
→ `App.jsx` - Add route configuration
→ `pages/` - Create new page component
→ `components/Sidebar.jsx` - Add menu item (if needed)

### "I want to modify task management"
→ `pages/Task/Task.jsx` - Main task view
→ `stores/useTaskStore.js` - Task state
→ `hooks/useTaskData.jsx` - Task fetching logic
→ `pages/Task/Components/*.jsx` - Task modals/forms

### "I want to modify the dashboard"
→ `components/Dashboard.jsx` - Main dashboard
→ `components/StatCard.jsx` - Statistics cards
→ `components/Charts/*.jsx` - Chart components
→ `data/statisticsCardData.js` - Card configurations

### "I want to add a new form"
→ `components/Design/FormComponents.jsx` - Reusable form inputs
→ `hooks/useApiMutation.jsx` - Form submission
→ Create new component in `pages/*/components/`

### "I want to modify the sidebar/navigation"
→ `components/Sidebar.jsx` - Sidebar component
→ `components/RootLayout.jsx` - Layout wrapper
→ `stores/useAuthStore.js` - Menu permissions

