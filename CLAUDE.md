# CLAUDE.md

File guide Claude Code (claude.ai/code) work code here.

## Repository Overview

**Multi-platform CRM system**, three apps:
- **Web Application** - React/Vite app, web or Electron desktop
- **Backend API** - Node.js/Express REST API + SQL Server
- **Mobile Application** - React Native/Expo mobile

Three apps share same backend API + auth. Unified CRM across platforms.

## Quick Start Commands

### Web Application (in `web/` directory)
```bash
npm run dev                 # Development server on port 8080
npm run build:web           # Build for web deployment
npm run build:electron      # Build for Electron desktop app
npm run electron:dev        # Run Electron in development mode
npm run dist:win-all        # Create Windows installers
npm run dist:mac            # Create macOS DMG
```

### Backend API (in `backend/` directory)
```bash
npm run dev                 # Development server with nodemon
npm run prod                # Production server
npm run pm2:start           # Start with PM2 cluster mode
npm run pm2:logs            # View PM2 logs
```

### Mobile Application (in `mobile/` directory)
```bash
npm start                   # Start Expo development server
npm run android             # Run on Android device/emulator
npm run ios                 # Run on iOS device/simulator
```

## System Architecture

### Data Flow
```
Mobile App ─┐
            ├──> Backend API ──> SQL Server Database
Web App ────┘
```

### Technology Stack Overview
- **Frontend**: React 18, React Native 0.79
- **State Management**: Zustand + persistence (all platforms)
- **API Communication**: Axios + interceptors
- **Backend**: Express.js, SQL Server (mssql)
- **Authentication**: JWT tokens + role-based access
- **Database**: SQL Server + stored procedures
- **Build Tools**: Vite (web), Expo (mobile), Electron Builder (desktop)

## Cross-Platform Development Patterns

### State Management
Three apps use **Zustand**, identical store patterns:
- `useAuthStore` - Auth, user data, permissions
- `useTaskStore` - Task state
- `useKanbanStore` - Kanban board state

Persist via:
- Web: `localStorage`
- Mobile: `AsyncStorage`

### API Integration
Same API base URL pattern:
- Production: `https://prdinfotech.in/CRM`
- Development: `http://localhost:5001`

**API Response Structure** (consistent across endpoints):
```json
{
  "success": true,
  "message": "Resource retrieved successfully",
  "responseCode": 200,
  "data": {
    "resourceName": [...],
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

### Authentication Flow
1. User login via `/api/auth/login`
2. Backend return JWT token + user data + menu permissions
3. Token stored Zustand store (persisted)
4. All next requests include token in Authorization header
5. Axios interceptors handle auto token inject + 401 responses

## Database Architecture

### Core Entity Relationships
```
tblUser ──┬── tblUser_Groups ──── tblUserGroups (Roles)
          │
          ├── tblTeamMembers ──── tblTeams
          │
          └── tblProjects ──┬── tblTasks (Hierarchical)
                            │
                            ├── tblTaskComments
                            ├── tblTaskChecklist
                            ├── tblTimeEntries
                            └── tblTaskActivity (Audit Trail)
```

### Stored Procedure Patterns
- **CRUD Operations**: `@Id=0` create, `@Id>0` update
- **Multi-tenancy**: All queries filtered by `@CompId` + `@BranchId`
- **Access Control**: Permission checks via JSON_VALUE for Members/Watchers
- **Pagination**: Standard `@PageNumber`, `@PageSize`, `@SearchTerm` params
- **Response Format**: Return `ResponseCode`, `ResponseMess`, data columns
- **Transaction Safety**: Critical ops wrapped BEGIN/COMMIT + error handling

### Permission System
**Hierarchical Access Control**:
1. **Role-based**: tblUserGroups → tblGroupAccess (menu-level perms)
2. **Resource-level**: Project/Task access via ownership, team membership, or JSON member lists
3. **Company Isolation**: Data filtered by CompId/BranchId
4. **Audit Trail**: Task ops logged to tblTaskActivity

## Project Structure Guidelines

### Web Application (`web/`)
```
src/
  ├── components/        # Reusable UI components
  │   ├── Design/       # Custom button/form components
  │   ├── Charts/       # ECharts visualization components
  │   └── [Feature]     # Feature-specific components
  ├── pages/            # Route components by feature
  ├── stores/           # Zustand state management
  ├── hooks/            # Custom React hooks (useApi, useApiQuery)
  ├── api/              # API query functions
  ├── utils/            # Utilities (platform detection, token utils)
  └── App.jsx           # Router configuration (Hash/Browser)
```

### Backend API (`backend/`)
```
src/
  ├── config/           # Centralized configuration
  │   ├── database.js   # SQL Server connection pool
  │   ├── middleware.js # Security, CORS, compression
  │   ├── routes.js     # Route registration
  │   └── errorHandlers.js
  ├── routes/           # Route definitions by feature
  ├── controllers/      # Business logic
  ├── middleware/       # Auth middleware
  └── utils/            # Response helpers, encryption
```

### Mobile Application (`mobile/`)
```
src/
  ├── navigation/       # React Navigation configuration
  ├── screens/          # Screen components
  ├── components/       # Reusable UI components
  ├── stores/           # Zustand state management
  ├── services/         # API services
  ├── hooks/            # Custom hooks
  └── constants/        # App constants, colors, fonts
```

## Development Workflows

### Adding a New Feature (Full Stack)

**1. Database Layer**
- Create/modify stored procedures SQL Server
- Naming convention: `sp_[Entity][Action]`
- Include permission checks + error handling
- Test with sample data

**2. Backend API**
- Add route `backend/src/routes/[feature]Routes.js`
- Controller method `backend/src/controllers/[feature]Controller.js`
- Use `database.executeStoredProcedure()` for DB calls
- Return standardized responses via `responseHelper.js`

**3. Web Frontend**
- API query function `web/src/api/[feature]Queries/`
- Page/component `web/src/pages/[Feature]/`
- Use `useApiQuery` hook for fetching
- Update routing in `App.jsx` if needed

**4. Mobile Frontend**
- Screen `mobile/src/screens/[Feature]/`
- Navigation route `mobile/src/navigation/`
- API service `mobile/src/services/`
- React Query hooks for fetching

### Platform-Specific Considerations

**Web/Electron**:
- Use `isElectron()` from `utils/platform.js` for platform detection
- HashRouter for Electron (file:// protocol), BrowserRouter for web
- Conditional rendering platform-specific features
- Build with `BUILD_TARGET` env var

**Mobile**:
- Use React Native APIs (no DOM access)
- Platform-specific code `Platform.OS`
- Safe areas via `SafeAreaView`
- Expo APIs for native features

## Key Features Implementation

### Task Management
- **Hierarchical Tasks**: Parent/child relationships + cascade restrictions
- **Kanban Board**: Drag-and-drop `@dnd-kit` (web) / React Native Reanimated (mobile)
- **Time Tracking**: tblTimeEntries with task associations
- **Comments & Checklists**: Full threading support
- **Activity Logging**: Full audit trail all ops

### Project Management
- **Team/Individual Access**: Projects assigned teams or individual members
- **JSON Member Lists**: Dynamic member assignment via JSON arrays
- **Budget Tracking**: Financial data per project
- **Hierarchical Permissions**: Manager → Team Lead → Members

### Authentication & Permissions
- **JWT-based**: Tokens include user ID, role, permissions
- **Menu-based Access**: Granular perms (Add/Edit/Delete/View)
- **Multi-tenant**: Company/Branch isolation at DB level
- **Session Management**: Auto token refresh + logout

## Environment Configuration

### Backend (`.env` files)
```
NODE_ENV=development
PORT=5001
DB_SERVER=localhost
DB_NAME=eCRM+
DB_USER=sa
DB_PASSWORD=***
BASE_URL=http://localhost:5001
```

### Web (Vite environment variables)
- `BUILD_TARGET=web|electron` - Determines build config
- Base URL hardcoded in auth store: `https://prdinfotech.in/CRM`

### Mobile (Expo configuration)
- API base URL in services layer
- AsyncStorage for persistence

## Testing & Debugging

### Backend
- Test DB connection: `GET /test-db`
- Health check: `GET /health`
- API docs: `GET /api` (HTML interface)
- JSON endpoints: `GET /` (returns routes)

### Web
- React Query DevTools in dev
- Browser DevTools for debugging
- Network tab for API call inspection

### Mobile
- Expo DevTools in browser
- React Native Debugger
- Flipper for advanced debugging

## Common Development Patterns

### API Query Hook (Web)
```javascript
const { data, isLoading, error } = useApiQuery({
  queryKey: ['resource', filters],
  queryFn: () => fetchResourceAPI(filters),
  enabled: true,
  onSuccess: (data) => { /* handle success */ }
});

// Extract data: data?.resourceName
```

### Form Handling (Web)
- React Hook Form + Zod validation
- Custom form components `components/Design/FormComponents.jsx`
- Consistent error handling + user feedback

### Zustand Store Pattern
```javascript
const useStore = create(
  persist(
    (set) => ({
      data: null,
      setData: (data) => set({ data }),
      clearData: () => set({ data: null })
    }),
    {
      name: 'store-name',
      storage: createJSONStorage(() => localStorage) // or AsyncStorage
    }
  )
);
```

## Deployment

### Backend
- PM2 cluster mode for prod
- IIS reverse proxy compat (runs on 127.0.0.1)
- Centralized logging to `logs/` directory

### Web
- Web build: Deploy to `/eStockCRM/` path + static files
- Electron: Windows (NSIS/Portable), macOS (DMG) via electron-builder

### Mobile
- Build via EAS Build service
- Separate iOS/Android builds
- OTA updates via Expo Updates

## Security Considerations

- **SQL Injection Prevention**: Queries use parameterized inputs
- **Authentication**: JWT tokens + expiration
- **CORS**: Configured specific origins
- **Rate Limiting**: Applied API endpoints
- **Helmet**: Security headers all responses
- **Multi-tenancy**: Enforced DB level (CompId/BranchId)

## Important Notes

- Each app own CLAUDE.md (see `web/CLAUDE.md`, `backend/CLAUDE.md`, `mobile/CLAUDE.md`)
- DB schema managed externally (no migrations in codebase)
- API responses include pagination metadata
- Use Postman/Thunder Client for API testing
- Mobile app active dev, full spec in `REACT_NATIVE_DEVELOPMENT_SPECIFICATION.md`

## Navigation Guide for Claude Instances

Navigate between app-specific docs + find right files for common tasks.

### Application-Specific Documentation

**Each app has CLAUDE.md: full file trees, import/export, quick nav:**

#### `web/CLAUDE.md` - Web/Electron Application Guide
- **When to use**: Frontend UI changes, routing, state, web-specific
- **Contains**: File tree 50+ components, imports/exports, relationships
- **Key sections**: State (Zustand), API hooks (useApiQuery), form components, charts
- **Quick links**: Auth (stores/useAuthStore.js), API client (utils/axiosConfig.js), routing (App.jsx)

#### `backend/CLAUDE.md` - Backend API Guide
- **When to use**: New API endpoints, controller logic, SP calls, middleware
- **Contains**: File tree routes, controllers, middleware, utilities, SP mappings
- **Key sections**: Route registration (config/routes.js), controllers + SP calls, auth middleware
- **Quick links**: DB config (config/database.js), auth routes (routes/authRoutes.js), task controller (controllers/taskController.js:218-716)

#### `mobile/CLAUDE.md` - React Native Mobile App Guide
- **When to use**: Mobile UI, RN screens, mobile features, navigation
- **Contains**: File tree 24 components, 9 screens, navigation, API services
- **Key sections**: Navigation (AppNavigator.jsx), API services (services/api.js), form components, modals
- **Quick links**: Auth store (stores/authStore.js), API client (services/api.js:1-540), theme (constants/theme.js)

### Quick Task Routing: Which App to Modify?

#### "I want to add/modify authentication"
1. **Backend**: `backend/src/controllers/authController.js` - Add auth endpoints
2. **Web**: `web/src/stores/useAuthStore.js` - Auth state (line 1-227)
3. **Mobile**: `mobile/src/stores/authStore.js` - Auth state (line 1-118)
4. **Shared**: Both frontends call `POST /api/auth/loginUser`

#### "I want to add a new API endpoint"
1. **Backend**: Start here - create route → controller → call SP
   - `backend/src/routes/[feature]Routes.js` - Define endpoint
   - `backend/src/controllers/[feature]Controller.js` - Business logic
   - `backend/src/config/routes.js` - Register route (line 1-224)
2. **Web**: Add API query function `web/src/api/` or use `useApiQuery` directly
3. **Mobile**: Add method `mobile/src/services/api.js` (line 1-540)

#### "I want to modify task management"
1. **Backend**: `backend/src/controllers/taskController.js` (LARGEST: 716 lines)
   - Calls SPs: `sp_SaveTask`, `sp_FetchTasks`, etc.
2. **Web**:
   - List view: `web/src/pages/Task/Task.jsx`
   - Task card: `web/src/components/TaskCard.jsx`
   - Task modal: `web/src/pages/Task/Components/TaskModal.jsx`
   - State: `web/src/stores/useTaskStore.js`
3. **Mobile**:
   - List view: `mobile/src/screens/TasksScreen.jsx`
   - Task card: `mobile/src/components/TaskCard.jsx`
   - Task modal: `mobile/src/components/TaskModal.jsx`
   - API: `mobile/src/services/api.js` → `taskAPI` object (line 231-393)

#### "I want to modify the dashboard"
1. **Backend**: `backend/src/controllers/dashboardController.js` - Stats calc
2. **Web**: `web/src/components/Dashboard.jsx` - Main dashboard + charts
3. **Mobile**: `mobile/src/screens/DashboardScreen.jsx` - Mobile dashboard

#### "I want to add a new database table/stored procedure"
1. **Database**: Create table/SP SQL Server (no migration files)
2. **Backend**: Controller method calling SP via `database.executeStoredProcedure()`
3. **Frontend**: Use existing API query patterns (useApiQuery web, React Query mobile)

#### "I want to modify permissions/access control"
1. **Backend**: `backend/src/middleware/auth.js` - JWT verify, permission checks
2. **Web**: `web/src/stores/useAuthStore.js` - hasPermission() method (line 132-140)
3. **Mobile**: `mobile/src/stores/authStore.js` - hasPermission() method (line 48-66)
4. **Database**: tblGroupAccess, tblUserGroups tables

#### "I want to add a new screen/page"
1. **Web**:
   - Component `web/src/pages/[Feature]/`
   - Route `web/src/App.jsx`
   - Sidebar menu item `web/src/components/Sidebar.jsx`
2. **Mobile**:
   - Screen `mobile/src/screens/[Feature]Screen.jsx`
   - Drawer `mobile/src/navigation/AppNavigator.jsx` (line 126-133)

#### "I want to modify styling/theme"
1. **Web**:
   - `web/src/theme.js` - MUI theme config
   - TailwindCSS classes in components
2. **Mobile**: `mobile/src/constants/theme.js` - Full theme object

### Cross-Platform File Patterns

Cross-platform, files serve similar purposes:

| Purpose | Web | Backend | Mobile |
|---------|-----|---------|--------|
| **Auth Store** | `stores/useAuthStore.js` (227 lines) | N/A | `stores/authStore.js` (118 lines) |
| **API Client** | `utils/axiosConfig.js` | N/A | `services/api.js` (540 lines) |
| **Main Entry** | `main.jsx` → `App.jsx` | `server.js` | `App.js` → `AppNavigator.jsx` |
| **Routing** | `App.jsx` (React Router) | `config/routes.js` (224 lines) | `navigation/AppNavigator.jsx` (489 lines) |
| **Theme** | `theme.js` (MUI) | N/A | `constants/theme.js` |

### File Reference Pattern Examples

**Pattern**: `filepath:line_number` = exact code location.

**Authentication flow**:
- Backend endpoint: `backend/src/routes/authRoutes.js:15` → `/api/auth/loginUser`
- Backend controller: `backend/src/controllers/authController.js:45-89` → `login()` method
- Web login page: `web/src/pages/auth/Login.jsx:54-79` → form submission
- Mobile login: `mobile/src/screens/LoginScreen.jsx:30-55` → authAPI.login()

**Task creation flow**:
- Backend route: `backend/src/routes/taskRoutes.js:8` → `POST /api/tasks/saveTask`
- Backend controller: `backend/src/controllers/taskController.js:45-120` → `save()` method calls `sp_SaveTask`
- Web modal: `web/src/pages/Task/Components/CreateTaskModal.jsx`
- Mobile modal: `mobile/src/components/AddTaskModal.jsx`

**Permissions check**:
- Backend middleware: `backend/src/middleware/auth.js:34-67` → `verifyToken()`
- Web store: `web/src/stores/useAuthStore.js:132-140` → `hasPermission()`
- Mobile store: `mobile/src/stores/authStore.js:48-66` → `hasPermission()`

### Common Development Scenarios

#### Scenario 1: "Add a new master data entity (e.g., Departments)"
1. **Database**: Create `tblDepartments` table + CRUD SPs
2. **Backend**:
   - Create `backend/src/routes/departmentRoutes.js`
   - Create `backend/src/controllers/departmentController.js`
   - Register `backend/src/config/routes.js`
3. **Web**:
   - Create `web/src/pages/Master/Departments.jsx` (copy Teams.jsx pattern)
   - Route `web/src/App.jsx`
4. **Mobile**:
   - Create `mobile/src/screens/DepartmentsScreen.jsx`
   - Add `mobile/src/navigation/AppNavigator.jsx`
   - API methods `mobile/src/services/api.js`

#### Scenario 2: "Modify task status options"
1. **Database**: Update `sp_SaveTask` validation if needed
2. **Backend**: No change (passes through)
3. **Web**: Update status dropdown `web/src/pages/Task/Components/CreateTaskModal.jsx`
4. **Mobile**: Update status picker `mobile/src/components/AddTaskModal.jsx`

#### Scenario 3: "Add a new chart to dashboard"
1. **Backend**: May need stats calc `backend/src/controllers/dashboardController.js`
2. **Web**:
   - Chart component `web/src/components/Charts/[ChartName].jsx`
   - Use in `web/src/components/Dashboard.jsx`
3. **Mobile**: Add chart `mobile/src/screens/DashboardScreen.jsx` (may need react-native-chart-kit)

### Using the Enhanced CLAUDE.md Files

Each app CLAUDE.md now includes:
1. **Complete File Tree**: Every file + purpose, imports, exports, usage
2. **Quick Navigation Guide**: "I want to..." → file paths
3. **Import/Export Mapping**: See imports at glance
4. **Line Number References**: Jump to code sections

**Example workflow**:
1. Start root CLAUDE.md (this) to pick app(s)
2. Open app CLAUDE.md for file structure
3. Use "Quick Navigation Guide" to find files
4. Reference line numbers for methods/logic