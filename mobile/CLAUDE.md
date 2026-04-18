# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an **eCRM (Customer Relationship Management)** React Native application built with Expo. The project is currently in initial setup phase with a comprehensive specification document but minimal implementation.

### Technology Stack
- **Framework**: React Native with Expo (~53.0.20)
- **Navigation**: React Navigation v7 (bottom tabs, drawer, stack)
- **State Management**: Zustand with persistence
- **HTTP Client**: Axios
- **Storage**: AsyncStorage
- **UI Libraries**: React Native Gesture Handler, Reanimated, SVG

## Development Commands

### Core Commands
```bash
# Start development server
npm start

# Platform-specific development
npm run android    # Start on Android
npm run ios        # Start on iOS  
npm run web        # Start web version
```

### Expo Commands
```bash
# Start with specific options
expo start --clear-cache    # Clear metro cache
expo start --tunnel         # Use tunnel connection
expo start --offline        # Work offline
```

## Architecture & Implementation Guide

### Current State
- Project is freshly initialized with default Expo template
- App.js contains basic "Hello World" template
- Comprehensive specification exists in `REACT_NATIVE_DEVELOPMENT_SPECIFICATION.md` (31K+ tokens)

### Application Structure (Per Specification)
The eCRM app should implement:

**Core Features:**
- JWT-based authentication with role-based permissions
- Dashboard with statistics cards and multiple chart types
- Task management with Kanban board and drag-drop
- Project management with team assignments
- Team and user management
- Master data configuration

**Navigation Flow:**
```
[Splash] → [Login] → [Dashboard] ↔ [Tasks] ↔ [Projects] ↔ [Teams] ↔ [Users] ↔ [Kanban Config]
```

**Key Implementation Patterns:**
- Use Zustand for state management with persistence
- Implement React Navigation v6 with tab/drawer navigation
- Use Axios with interceptors for API calls
- Follow component-based architecture with custom UI components
- Implement form validation with React Hook Form + Zod

### State Management
- **Primary**: Zustand stores with AsyncStorage persistence
- **API State**: Axios with interceptors for auth and error handling
- **Form State**: React Hook Form for complex forms

### Styling Approach
- Custom components following design system specifications
- Gradient backgrounds and modern UI patterns
- Responsive design for mobile and tablet layouts
- Color scheme defined in specification document

## Development Guidelines

### CRITICAL DESIGN REFERENCES
**ALWAYS consult these two primary sources before making UI/UX decisions:**

1. **HTML Design Reference**: `ecrm-mobile-ui.html` in project root
   - Contains exact UI designs for all screens (Welcome, Login, Dashboard, Tasks, Kanban, etc.)
   - Shows precise styling, colors, spacing, animations, and component layouts
   - **MUST match this design exactly** - use same colors, gradients, shadows, typography
   - Reference this for proper component structure and visual hierarchy

2. **React Native Documentation**: https://reactnative.dev/
   - Always verify component APIs and props before implementation
   - Check for latest best practices and performance considerations
   - Ensure cross-platform compatibility (iOS/Android)
   - Reference for proper styling patterns and component usage

### File Organization
When implementing features, follow this structure:
```
src/
  components/     # Reusable UI components
  screens/        # Screen components
  navigation/     # Navigation configuration
  stores/         # Zustand stores
  services/       # API services and utilities
  constants/      # App constants and config
  types/          # TypeScript type definitions
```

### Key Implementation Notes
- The app uses Expo's new architecture (`"newArchEnabled": true`)
- All dependencies are already configured in package.json
- **ALWAYS reference `ecrm-mobile-ui.html` for exact UI implementation**
- **ALWAYS check React Native docs for component APIs and best practices**
- Authentication should use JWT tokens with role-based access
- Charts should use Victory Native or react-native-chart-kit
- Drag & drop functionality needed for Kanban boards

### UI/UX Implementation Rules
1. **Design Fidelity**: Match `ecrm-mobile-ui.html` exactly - colors, spacing, animations, typography
2. **Component Structure**: Follow React Native best practices from official documentation
3. **Cross-Platform**: Ensure components work on both iOS and Android
4. **Performance**: Use React Native performance best practices (FlatList, memo, etc.)
5. **Accessibility**: Follow React Native accessibility guidelines

### API Integration
- Base URL and endpoints defined in specification
- Implement Axios interceptors for token management
- Handle authentication state globally with Zustand
- Implement proper error handling and user feedback

## Next Steps for Development

When implementing this application:
1. Read the full specification document for detailed requirements
2. Set up proper project structure with src/ directory
3. Implement authentication system first
4. Create reusable component library
5. Set up navigation structure
6. Implement Zustand stores for state management
7. Build screens according to specification layouts

## Complete File Structure & Dependencies

This section maps every file, its purpose, what it imports, and where it's used. Use this as a quick reference to navigate the codebase.

### Entry Point

#### `App.js` - Application Entry Point
- **Purpose**: React Native app initialization, provider setup, font loading
- **Imports**:
  - `StatusBar` from expo-status-bar
  - `SafeAreaProvider` from react-native-safe-area-context
  - `GestureHandlerRootView` from react-native-gesture-handler
  - `SplashScreen` from expo-splash-screen
  - `QueryClient`, `QueryClientProvider` from @tanstack/react-query
  - `AppNavigator` from ./src/navigation/AppNavigator
  - `useAppFonts`, `getFontFamily` from ./src/constants/fonts
- **Exports**: `App` component (default)
- **Used by**: Expo entry point (index.js)
- **Key setup**: React Query config (5min stale time, 10min cache), font loading, splash screen handling

### State Management (`src/stores/`)

#### `stores/authStore.js` - Authentication State (PRIMARY STORE)
- **Purpose**: User auth, permissions, token management, session validation
- **Imports**:
  - `AsyncStorage` from @react-native-async-storage/async-storage
  - `create` from zustand
  - `persist`, `createJSONStorage` from zustand/middleware
- **Exports**: `useAuthStore` (named export)
- **Used by**:
  - navigation/AppNavigator.jsx (auth state, token validation)
  - screens/LoginScreen.jsx (login action)
  - All screens (user data, permissions)
  - services/api.js (token retrieval)
- **State**: isAuthenticated, isLoading, token, user, company, permissions, loginTimestamp
- **Methods**: login(), logout(), setLoading(), hasPermission(), isTokenValid(), getUserRole(), clearAuth()

### Navigation (`src/navigation/`)

#### `navigation/AppNavigator.jsx` - Navigation Configuration (LARGEST: 489 lines)
- **Purpose**: React Navigation setup with Stack + Drawer, permissions-based menu, auth flow
- **Imports**:
  - `NavigationContainer` from @react-navigation/native
  - `createStackNavigator` from @react-navigation/stack
  - `createDrawerNavigator` from @react-navigation/drawer
  - `useAuthStore` from ../stores/authStore
  - `theme` from ../constants/theme
  - All screen components (Welcome, Login, Dashboard, Tasks, Projects, Teams, Users, Kanban)
  - Custom icons from ../components/Icons
- **Exports**: `AppNavigator` component (default)
- **Used by**: App.js
- **Screens**:
  - Auth flow: Welcome, Login
  - Main app: Dashboard, Tasks, Projects, Teams, Users, Kanban Columns
- **Navigation pattern**: Conditional rendering based on isAuthenticated, Stack navigator with Drawer for authenticated users

### API Layer (`src/services/`)

#### `services/api.js` - API Client & All API Methods (LARGEST: 540 lines)
- **Purpose**: Axios instance, interceptors, auth token management, all API endpoint functions
- **Imports**:
  - `axios` from axios
  - `AsyncStorage` from @react-native-async-storage/async-storage
- **Exports**:
  - `userAPI` (fetchUsers, saveUser, deleteUser)
  - `userGroupAPI` (fetchUserGroups)
  - `authAPI` (login, logout)
  - `dashboardAPI` (getStats)
  - `taskAPI` (fetchTasks, saveTask, deleteTask, fetchComments, addComment, fetchTimeEntries, logTime, deleteComment, deleteTimeEntry, fetchChecklist, saveChecklist, deleteChecklist)
  - `projectAPI` (fetchProjects, saveProject, deleteProject)
  - `teamAPI` (fetchTeams, saveTeam, deleteTeam)
  - `kanbanAPI` (fetchColumns, saveColumn, deleteColumn)
- **Used by**: All screens (via React Query hooks)
- **Base URL**: https://prdinfotech.in/CRM
- **Interceptors**:
  - Request: Injects Authorization Bearer token from AsyncStorage
  - Response: Handles 401 (auto logout), error formatting

### Screens (`src/screens/`)

#### `screens/WelcomeScreen.jsx` - Welcome/Splash Screen
- **Purpose**: App intro screen with branding, navigation to login
- **Imports**:
  - React Native components (View, Text, TouchableOpacity)
  - `theme` from ../constants/theme
  - `Logo` from ../components/Logo
- **Exports**: `WelcomeScreen` component (default)
- **Used by**: navigation/AppNavigator.jsx
- **Logic**: Show app logo, welcome message, "Get Started" button → navigate to Login

#### `screens/LoginScreen.jsx` - Login Screen
- **Purpose**: User authentication form
- **Imports**:
  - React Native components
  - `useAuthStore` from ../stores/authStore
  - `authAPI` from ../services/api
  - `Logo`, `Button`, `FormField` from ../components
  - `theme` from ../constants/theme
- **Exports**: `LoginScreen` component (default)
- **Used by**: navigation/AppNavigator.jsx
- **API Calls**: authAPI.login(username, password)
- **Logic**: Form submission, store token via authStore.login(), navigate to MainApp

#### `screens/DashboardScreen.jsx` - Dashboard Screen
- **Purpose**: Main dashboard with statistics and charts
- **Imports**:
  - React Native components (View, Text, ScrollView, RefreshControl)
  - `useQuery` from @tanstack/react-query
  - `dashboardAPI` from ../services/api
  - `useAuthStore` from ../stores/authStore
  - `Header`, `StatsCards` from ../components
  - `theme` from ../constants/theme
- **Exports**: `DashboardScreen` component (default)
- **Used by**: navigation/AppNavigator.jsx (Drawer screen)
- **API Calls**: dashboardAPI.getStats()
- **Logic**: Fetch dashboard stats, display stats cards, handle refresh

#### `screens/TasksScreen.jsx` - Tasks List Screen
- **Purpose**: Task list view with filters, search, task creation
- **Imports**:
  - React Native components (FlatList, RefreshControl)
  - `useQuery`, `useMutation`, `useQueryClient` from @tanstack/react-query
  - `taskAPI`, `projectAPI`, `teamAPI`, `userAPI` from ../services/api
  - `useAuthStore` from ../stores/authStore
  - `HeaderWithSearch`, `TaskCard`, `FAB`, `AddTaskModal`, `TaskFilters` from ../components
  - `theme` from ../constants/theme
- **Exports**: `TasksScreen` component (default)
- **Used by**: navigation/AppNavigator.jsx (Drawer screen)
- **API Calls**:
  - taskAPI.fetchTasks()
  - taskAPI.saveTask()
  - taskAPI.deleteTask()
- **Logic**: Task list rendering, search, filters, create/edit/delete tasks

#### `screens/KanbanScreen.jsx` - Kanban Board Screen
- **Purpose**: Kanban column management (not drag-drop board)
- **Imports**:
  - React Native components
  - `useQuery`, `useMutation`, `useQueryClient` from @tanstack/react-query
  - `kanbanAPI`, `projectAPI` from ../services/api
  - `useAuthStore` from ../stores/authStore
  - `Header`, `FAB`, `FormModal` from ../components
  - `theme` from ../constants/theme
- **Exports**: `KanbanScreen` component (default)
- **Used by**: navigation/AppNavigator.jsx (Drawer screen)
- **API Calls**:
  - kanbanAPI.fetchColumns()
  - kanbanAPI.saveColumn()
  - kanbanAPI.deleteColumn()
- **Logic**: List kanban columns, create/edit/delete columns

#### `screens/ProjectsScreen.jsx` - Projects Management Screen
- **Purpose**: CRUD operations for projects
- **Imports**:
  - React Native components
  - `useQuery`, `useMutation`, `useQueryClient` from @tanstack/react-query
  - `projectAPI`, `teamAPI`, `userAPI` from ../services/api
  - `useAuthStore` from ../stores/authStore
  - `Header`, `FAB`, `FormModal`, `SearchBar` from ../components
  - `theme` from ../constants/theme
- **Exports**: `ProjectsScreen` component (default)
- **Used by**: navigation/AppNavigator.jsx (Drawer screen)
- **API Calls**:
  - projectAPI.fetchProjects()
  - projectAPI.saveProject()
  - projectAPI.deleteProject()
- **Logic**: Project list, search, create/edit/delete projects

#### `screens/TeamsScreen.jsx` - Teams Management Screen
- **Purpose**: CRUD operations for teams
- **Imports**:
  - React Native components
  - `useQuery`, `useMutation`, `useQueryClient` from @tanstack/react-query
  - `teamAPI`, `userAPI` from ../services/api
  - `useAuthStore` from ../stores/authStore
  - `Header`, `FAB`, `FormModal`, `SearchBar` from ../components
  - `theme` from ../constants/theme
- **Exports**: `TeamsScreen` component (default)
- **Used by**: navigation/AppNavigator.jsx (Drawer screen)
- **API Calls**:
  - teamAPI.fetchTeams()
  - teamAPI.saveTeam()
  - teamAPI.deleteTeam()
- **Logic**: Team list, search, create/edit/delete teams

#### `screens/UsersScreen.jsx` - Users Management Screen
- **Purpose**: CRUD operations for users
- **Imports**:
  - React Native components
  - `useQuery`, `useMutation`, `useQueryClient` from @tanstack/react-query
  - `userAPI`, `userGroupAPI` from ../services/api
  - `useAuthStore` from ../stores/authStore
  - `Header`, `FAB`, `FormModal`, `SearchBar` from ../components
  - `theme` from ../constants/theme
- **Exports**: `UsersScreen` component (default)
- **Used by**: navigation/AppNavigator.jsx (Drawer screen)
- **API Calls**:
  - userAPI.fetchUsers()
  - userAPI.saveUser()
  - userAPI.deleteUser()
- **Logic**: User list, search, create/edit/delete users

#### `screens/PlaceholderScreen.jsx` - Generic Placeholder Screen
- **Purpose**: Placeholder for unimplemented screens
- **Imports**: React Native components
- **Exports**: `PlaceholderScreen` component (default)
- **Used by**: Not currently used (for future screens)
- **Logic**: Shows "Coming Soon" message

### Core Components (`src/components/`)

#### `components/Header.jsx` - Screen Header
- **Purpose**: Standard screen header with title and optional back button
- **Imports**:
  - React Native components (View, Text, TouchableOpacity)
  - `useNavigation` from @react-navigation/native
  - `theme` from ../constants/theme
  - Icons from lucide-react-native
- **Exports**: `Header` component (default)
- **Used by**: DashboardScreen, KanbanScreen, ProjectsScreen, TeamsScreen, UsersScreen
- **Props**: title, showBackButton, onBackPress

#### `components/HeaderWithSearch.jsx` - Header with Search Bar
- **Purpose**: Header component with integrated search input
- **Imports**:
  - React Native components (View, Text, TextInput, TouchableOpacity)
  - `useNavigation` from @react-navigation/native
  - `theme` from ../constants/theme
  - Icons from lucide-react-native
- **Exports**: `HeaderWithSearch` component (default)
- **Used by**: TasksScreen
- **Props**: title, searchQuery, onSearchChange, placeholder

#### `components/HeaderFilters.jsx` - Header with Filter Controls
- **Purpose**: Header with filter dropdowns and search
- **Imports**:
  - React Native components
  - `theme` from ../constants/theme
  - `FilterSelect` component
- **Exports**: `HeaderFilters` component (default)
- **Used by**: TasksScreen (alternative to HeaderWithSearch)
- **Props**: filters, onFilterChange, filterOptions

#### `components/Logo.jsx` - App Logo Component
- **Purpose**: Branded app logo
- **Imports**: React Native Image component
- **Exports**: `Logo` component (default)
- **Used by**: WelcomeScreen, LoginScreen
- **Logic**: Renders app logo image

#### `components/Button.jsx` - Primary Button Component
- **Purpose**: Reusable styled button with variants
- **Imports**:
  - React Native components (TouchableOpacity, Text, ActivityIndicator)
  - `theme` from ../constants/theme
- **Exports**: `Button` component (default)
- **Used by**: LoginScreen, WelcomeScreen, all forms
- **Props**: title, onPress, variant (primary|secondary|outline), loading, disabled

#### `components/FAB.jsx` - Floating Action Button
- **Purpose**: Floating action button for create actions
- **Imports**:
  - React Native components (TouchableOpacity)
  - `theme` from ../constants/theme
  - `Plus` icon from lucide-react-native
- **Exports**: `FAB` component (default)
- **Used by**: TasksScreen, ProjectsScreen, TeamsScreen, UsersScreen, KanbanScreen
- **Props**: onPress

#### `components/BigCard.jsx` - Large Card Container
- **Purpose**: Large card component for dashboard items
- **Imports**: React Native components (View)
- **Exports**: `BigCard` component (default)
- **Used by**: DashboardScreen
- **Props**: children, style

#### `components/StatsCards.jsx` - Statistics Cards Grid
- **Purpose**: Grid of statistics cards
- **Imports**:
  - React Native components (View, Text)
  - `theme` from ../constants/theme
  - Icons from lucide-react-native
- **Exports**: `StatsCards` component (default)
- **Used by**: DashboardScreen
- **Props**: stats (array of {title, value, icon, color})

#### `components/TaskCard.jsx` - Task Item Card
- **Purpose**: Individual task card for list view
- **Imports**:
  - React Native components (View, Text, TouchableOpacity)
  - `theme` from ../constants/theme
  - Icons from lucide-react-native
- **Exports**: `TaskCard` component (default)
- **Used by**: TasksScreen
- **Props**: task, onPress, onEdit, onDelete

#### `components/SearchBar.jsx` - Search Input Component
- **Purpose**: Search input field
- **Imports**:
  - React Native components (View, TextInput)
  - `theme` from ../constants/theme
  - `Search` icon from lucide-react-native
- **Exports**: `SearchBar` component (default)
- **Used by**: ProjectsScreen, TeamsScreen, UsersScreen
- **Props**: value, onChangeText, placeholder

### Form Components (`src/components/`)

#### `components/FormField.jsx` - Generic Form Input Field
- **Purpose**: Standard text input with label and error handling
- **Imports**:
  - React Native components (View, Text, TextInput)
  - `theme` from ../constants/theme
- **Exports**: `FormField` component (default)
- **Used by**: LoginScreen, all forms
- **Props**: label, value, onChangeText, placeholder, error, secureTextEntry, keyboardType, multiline

#### `components/SelectField.jsx` - Dropdown Select Field
- **Purpose**: Dropdown picker for single selection
- **Imports**:
  - React Native components (View, Text, TouchableOpacity, Modal, FlatList)
  - `theme` from ../constants/theme
  - `ChevronDown` icon from lucide-react-native
- **Exports**: `SelectField` component (default)
- **Used by**: FormModal, AddTaskModal, all forms
- **Props**: label, value, onValueChange, options, placeholder, error

#### `components/MultiSelectField.jsx` - Multi-Select Field
- **Purpose**: Multi-selection dropdown
- **Imports**:
  - React Native components (View, Text, TouchableOpacity, Modal, FlatList)
  - `theme` from ../constants/theme
  - `CheckboxField` component
- **Exports**: `MultiSelectField` component (default)
- **Used by**: FormModal (for team members, project members)
- **Props**: label, value, onValueChange, options, placeholder, error

#### `components/DateField.jsx` - Date Picker Field
- **Purpose**: Date input with date picker
- **Imports**:
  - React Native components (View, Text, TouchableOpacity, Platform)
  - `DateTimePicker` from @react-native-community/datetimepicker
  - `theme` from ../constants/theme
  - `Calendar` icon from lucide-react-native
- **Exports**: `DateField` component (default)
- **Used by**: FormModal, AddTaskModal (for due dates, start/end dates)
- **Props**: label, value, onValueChange, placeholder, error

#### `components/CheckboxField.jsx` - Checkbox Input
- **Purpose**: Checkbox with label
- **Imports**:
  - React Native components (View, Text, TouchableOpacity)
  - `theme` from ../constants/theme
  - `Check` icon from lucide-react-native
- **Exports**: `CheckboxField` component (default)
- **Used by**: MultiSelectField, FormModal
- **Props**: label, value, onValueChange

#### `components/FieldRow.jsx` - Form Field Row Container
- **Purpose**: Horizontal layout for form fields
- **Imports**: React Native components (View)
- **Exports**: `FieldRow` component (default)
- **Used by**: FormModal (for side-by-side inputs)
- **Props**: children

#### `components/FilterSelect.jsx` - Filter Dropdown Component
- **Purpose**: Small dropdown for filters
- **Imports**:
  - React Native components (View, TouchableOpacity, Modal, FlatList, Text)
  - `theme` from ../constants/theme
  - `ChevronDown` icon from lucide-react-native
- **Exports**: `FilterSelect` component (default)
- **Used by**: HeaderFilters, TaskFilters
- **Props**: value, onValueChange, options, placeholder

### Modal Components (`src/components/`)

#### `components/FormModal.jsx` - Generic Form Modal
- **Purpose**: Full-screen modal for create/edit forms (Projects, Teams, Users, Kanban)
- **Imports**:
  - React Native components (Modal, View, Text, ScrollView, TouchableOpacity, ActivityIndicator)
  - `theme` from ../constants/theme
  - `X` icon from lucide-react-native
  - All form field components
- **Exports**: `FormModal` component (default)
- **Used by**: ProjectsScreen, TeamsScreen, UsersScreen, KanbanScreen
- **Props**: visible, onClose, title, fields (array of field configs), onSubmit, loading

#### `components/AddTaskModal.jsx` - Task Creation Modal
- **Purpose**: Specialized modal for task creation
- **Imports**:
  - React Native components (Modal, View, Text, ScrollView, TouchableOpacity, ActivityIndicator)
  - `theme` from ../constants/theme
  - Form field components
- **Exports**: `AddTaskModal` component (default)
- **Used by**: TasksScreen
- **Props**: visible, onClose, onSubmit, projects, teams, users

#### `components/TaskModal.jsx` - Task Details Modal
- **Purpose**: Full task details view with comments, time tracking, checklist
- **Imports**:
  - React Native components (Modal, View, Text, ScrollView, TouchableOpacity, ActivityIndicator)
  - `useQuery`, `useMutation` from @tanstack/react-query
  - `taskAPI` from ../services/api
  - `useAuthStore` from ../stores/authStore
  - `theme` from ../constants/theme
- **Exports**: `TaskModal` component (default)
- **Used by**: TasksScreen
- **Props**: visible, onClose, taskId
- **API Calls**:
  - taskAPI.fetchComments()
  - taskAPI.addComment()
  - taskAPI.fetchTimeEntries()
  - taskAPI.logTime()
  - taskAPI.fetchChecklist()
  - taskAPI.saveChecklist()

#### `components/TaskFilters.jsx` - Task Filter Modal
- **Purpose**: Filter options modal for tasks
- **Imports**:
  - React Native components (Modal, View, Text, TouchableOpacity)
  - `theme` from ../constants/theme
  - `FilterSelect` component
- **Exports**: `TaskFilters` component (default)
- **Used by**: TasksScreen
- **Props**: visible, onClose, filters, onFilterChange, projects, teams, users

#### `components/BottomSheetModal.jsx` - Bottom Sheet Modal
- **Purpose**: Bottom sheet for mobile-friendly modals
- **Imports**:
  - React Native components (Modal, View, TouchableOpacity, Animated)
  - `theme` from ../constants/theme
- **Exports**: `BottomSheetModal` component (default)
- **Used by**: Not currently used (for future features)
- **Props**: visible, onClose, children

#### `components/Dialog.jsx` - Confirmation Dialog
- **Purpose**: Confirmation dialog for destructive actions
- **Imports**:
  - React Native components (Modal, View, Text, TouchableOpacity)
  - `theme` from ../constants/theme
- **Exports**: `Dialog` component (default)
- **Used by**: All screens (for delete confirmations)
- **Props**: visible, onClose, title, message, onConfirm, confirmText, cancelText

### Icon Components (`src/components/`)

#### `components/Icons.jsx` - Custom Icon Components
- **Purpose**: Custom-drawn navigation icons
- **Imports**:
  - React Native components (View)
  - `theme` from ../constants/theme
- **Exports**:
  - `DashboardIcon`
  - `TasksIcon`
  - `ProjectsIcon`
  - `TeamsIcon`
  - `UsersIcon`
  - `SettingsIcon`
  - `LogoutIcon`
- **Used by**: navigation/AppNavigator.jsx (drawer menu)
- **Logic**: Custom SVG-like icons using React Native Views

#### `components/ChartIcon.jsx` - Chart Icon Component
- **Purpose**: Chart/statistics icon
- **Imports**: React Native components (View)
- **Exports**: `ChartIcon` component (default)
- **Used by**: StatsCards
- **Props**: size, color

### Constants (`src/constants/`)

#### `constants/theme.js` - Theme Configuration
- **Purpose**: Centralized theme constants (colors, spacing, typography)
- **Imports**: None
- **Exports**: `theme` object
- **Used by**: All components
- **Config**:
  - colors: primary, secondary, gray scale, status colors
  - spacing: 4px base scale (1-12)
  - typography: font sizes, weights
  - borderRadius, shadow values

#### `constants/fonts.js` - Font Configuration
- **Purpose**: Custom font loading and helper functions
- **Imports**:
  - `useFonts` from expo-font
  - Font files from ../assets/fonts
- **Exports**:
  - `useAppFonts` (hook)
  - `getFontFamily` (helper function)
- **Used by**: App.js
- **Logic**: Load custom fonts (Inter family), provide font family getter

## Quick Navigation Guide

### "I want to modify authentication"
→ `stores/authStore.js` - Auth state
→ `screens/LoginScreen.jsx` - Login UI
→ `services/api.js` - Auth API calls, token interceptors
→ `navigation/AppNavigator.jsx` - Auth flow navigation

### "I want to add a new API endpoint"
→ `services/api.js` - Add new API method to appropriate API object (userAPI, taskAPI, etc.)
→ Update screen to use new endpoint via React Query

### "I want to add a new screen"
→ `screens/` - Create new screen component
→ `navigation/AppNavigator.jsx` - Add to Drawer.Navigator
→ `stores/authStore.js` - May need permission checking

### "I want to modify task management"
→ `screens/TasksScreen.jsx` - Main task list
→ `components/TaskCard.jsx` - Task item display
→ `components/AddTaskModal.jsx` - Task creation
→ `components/TaskModal.jsx` - Task details/edit
→ `services/api.js` - taskAPI methods

### "I want to modify the navigation/menu"
→ `navigation/AppNavigator.jsx` - Navigation structure, drawer menu
→ `components/Icons.jsx` - Custom menu icons
→ `stores/authStore.js` - Permission-based menu filtering

### "I want to add a new form field type"
→ `components/` - Create new field component following FormField.jsx pattern
→ Use in FormModal.jsx or AddTaskModal.jsx

### "I want to modify the theme/styling"
→ `constants/theme.js` - Global theme constants
→ `constants/fonts.js` - Font configuration
→ All components use theme object for consistent styling

### "I want to handle API errors differently"
→ `services/api.js` - Update response interceptor
→ Screen components - Update error handling in useMutation/useQuery

### "I want to add offline support"
→ `services/api.js` - Update interceptors for offline detection
→ `@tanstack/react-query` - Already provides cache/stale-while-revalidate
→ Consider adding `@react-native-async-storage/async-storage` for data persistence