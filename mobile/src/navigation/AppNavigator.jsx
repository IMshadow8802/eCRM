import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { TouchableOpacity, Text, StyleSheet, View, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuthStore } from '../stores/authStore';
import { theme } from '../constants/theme';
import { 
  DashboardIcon, 
  TasksIcon, 
  ProjectsIcon, 
  TeamsIcon, 
  UsersIcon, 
  SettingsIcon, 
  LogoutIcon 
} from '../components/Icons';

// Screens
import WelcomeScreen from '../screens/WelcomeScreen';
import LoginScreen from '../screens/LoginScreen';
import DashboardScreen from '../screens/DashboardScreen';
import ProjectsScreen from '../screens/ProjectsScreen';
import TeamsScreen from '../screens/TeamsScreen';
import UsersScreen from '../screens/UsersScreen';
import TasksScreen from '../screens/TasksScreen';
import KanbanScreen from '../screens/KanbanScreen';

const Stack = createStackNavigator();
const Drawer = createDrawerNavigator();

// Custom Drawer Content
const CustomDrawerContent = ({ navigation }) => {
  const { user, logout, permissions } = useAuthStore();

  const handleLogout = () => {
    logout();
    navigation.reset({
      index: 0,
      routes: [{ name: 'Welcome' }],
    });
  };

  // Get menu items from permissions (from your login response)
  const getMenuItems = () => {
    if (!permissions?.menuItems) return [];
    
    return permissions.menuItems.map(item => ({
      name: item.description,
      screen: item.description, // Dashboard, Tasks, Projects, etc.
      icon: getIconForMenu(item.description),
      menuItem: item
    }));
  };

  const getIconForMenu = (description) => {
    const iconMap = {
      'Dashboard': <DashboardIcon size={20} />,
      'Tasks': <TasksIcon size={20} />,
      'Projects': <ProjectsIcon size={20} />,
      'Teams': <TeamsIcon size={20} />,
      'Users': <UsersIcon size={20} />,
      'Kanban Columns': <SettingsIcon size={20} />
    };
    return iconMap[description] || <SettingsIcon size={20} />;
  };

  const menuItems = getMenuItems();

  return (
    <View style={styles.drawerContainer}>
      {/* User Section */}
      <View style={styles.userSection}>
        <View style={styles.userAvatar}>
          <Text style={styles.userInitials}>
            {user?.fullName?.charAt(0) || user?.username?.charAt(0) || 'U'}
          </Text>
        </View>
        <View style={styles.userInfo}>
          <Text style={styles.userName}>{user?.fullName || user?.username || 'User'}</Text>
          <Text style={styles.userEmail}>{user?.email || 'user@company.com'}</Text>
          <Text style={styles.userRole}>{user?.jobTitle || (user?.isadmin ? 'Administrator' : 'User')}</Text>
        </View>
      </View>

      {/* Menu Items */}
      <View style={styles.menuContainer}>
        {menuItems.map((item) => {
          return (
            <TouchableOpacity
              key={item.screen}
              style={styles.menuItem}
              onPress={() => navigation.navigate(item.screen)}
            >
              {item.icon}
              <Text style={styles.menuText}>{item.name}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Logout Button */}
      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <LogoutIcon size={20} />
        <Text style={styles.logoutText}>Logout</Text>
      </TouchableOpacity>
    </View>
  );
};


// Main App Navigator with Drawer for menu access
const MainAppNavigator = () => {
  return (
    <Drawer.Navigator
      drawerContent={(props) => <CustomDrawerContent {...props} />}
      initialRouteName="Dashboard"
      screenOptions={{
        headerShown: false,
        drawerStyle: {
          backgroundColor: theme.colors.white,
          width: 280,
        },
      }}
    >
      <Drawer.Screen name="Dashboard" component={DashboardScreen} />
      <Drawer.Screen name="Tasks" component={TasksScreen} />
      <Drawer.Screen name="Projects" component={ProjectsScreen} />
      <Drawer.Screen name="Teams" component={TeamsScreen} />
      <Drawer.Screen name="Users" component={UsersScreen} />
      <Drawer.Screen name="Kanban Columns" component={KanbanScreen} />
    </Drawer.Navigator>
  );
};

// Root Navigator
const AppNavigator = () => {
  const { isAuthenticated, isTokenValid, token, user } = useAuthStore();
  const [isHydrated, setIsHydrated] = useState(false);

  // Wait for Zustand persist to rehydrate the store
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsHydrated(true);
    }, 100); // Small delay to ensure store is rehydrated

    return () => clearTimeout(timer);
  }, []);


  // Show loading screen while waiting for auth state to load
  if (!isHydrated) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.colors.primary.brand} />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  // Check if user should be authenticated
  const shouldShowMainApp = isAuthenticated && token && isTokenValid();

  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
        }}
      >
        {shouldShowMainApp ? (
          // User is authenticated - show main app first
          <>
            <Stack.Screen name="MainApp" component={MainAppNavigator} />
            <Stack.Screen name="Welcome" component={WelcomeScreen} />
            <Stack.Screen name="Login" component={LoginScreen} />
          </>
        ) : (
          // User is not authenticated - show auth flow first
          <>
            <Stack.Screen name="Welcome" component={WelcomeScreen} />
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="MainApp" component={MainAppNavigator} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
};

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.white,
  },
  loadingText: {
    marginTop: theme.spacing[3],
    fontSize: theme.typography.fontSizes.base,
    color: theme.colors.gray[600],
  },
  tabIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabIconActive: {
    backgroundColor: theme.colors.gray[100],
  },
  tabIconCreate: {
    backgroundColor: theme.colors.primary.brand,
    borderRadius: 18,
  },
  tabIconText: {
    fontSize: 20,
    fontWeight: theme.typography.fontWeights.semibold,
  },
  drawerContainer: {
    flex: 1,
    backgroundColor: theme.colors.white,
  },
  userSection: {
    backgroundColor: theme.colors.primary.brand,
    padding: theme.spacing[5],
    paddingTop: theme.spacing[12], // Extra top padding for status bar
    flexDirection: 'row',
    alignItems: 'center',
  },
  userAvatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: theme.spacing[3],
  },
  userInitials: {
    color: theme.colors.white,
    fontSize: theme.typography.fontSizes.xl,
    fontWeight: theme.typography.fontWeights.bold,
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    color: theme.colors.white,
    fontSize: theme.typography.fontSizes.lg,
    fontWeight: theme.typography.fontWeights.bold,
  },
  userEmail: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: theme.typography.fontSizes.sm,
  },
  userRole: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: theme.typography.fontSizes.xs,
  },
  menuContainer: {
    flex: 1,
    paddingTop: theme.spacing[4],
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing[5],
    paddingVertical: theme.spacing[4],
  },
  menuIconContainer: {
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: theme.spacing[3],
  },
  menuText: {
    fontSize: theme.typography.fontSizes.base,
    color: theme.colors.gray[700],
    fontWeight: theme.typography.fontWeights.normal,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing[5],
    paddingVertical: theme.spacing[4],
    borderTopWidth: 1,
    borderTopColor: theme.colors.gray[200],
    marginBottom: theme.spacing[4],
  },
  logoutText: {
    fontSize: theme.typography.fontSizes.base,
    color: theme.colors.status.error,
    fontWeight: theme.typography.fontWeights.semibold,
  },
  // Dashboard Icon
  dashboardIcon: {
    width: 18,
    height: 14,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
  },
  dashboardBar: {
    width: 3,
    height: 6,
    backgroundColor: theme.colors.gray[700],
    borderRadius: 1,
  },
  dashboardBarMedium: {
    height: 10,
  },
  dashboardBarTall: {
    height: 14,
  },
  // Tasks Icon
  tasksIcon: {
    width: 16,
    height: 20,
    position: 'relative',
  },
  tasksIconBody: {
    width: 16,
    height: 20,
    borderRadius: 2,
    backgroundColor: theme.colors.gray[700],
  },
  tasksIconClip: {
    position: 'absolute',
    top: -2,
    left: 4,
    width: 8,
    height: 6,
    borderRadius: 2,
    backgroundColor: theme.colors.gray[600],
  },
  // Projects Icon
  projectsIcon: {
    width: 18,
    height: 16,
    position: 'relative',
  },
  projectsIconBody: {
    width: 18,
    height: 12,
    borderRadius: 2,
    backgroundColor: theme.colors.gray[700],
    position: 'absolute',
    bottom: 0,
  },
  projectsIconTab: {
    width: 8,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.gray[700],
    position: 'absolute',
    top: 0,
    left: 0,
  },
  // Teams Icon
  teamsIcon: {
    width: 20,
    height: 16,
    position: 'relative',
  },
  teamPerson: {
    width: 8,
    height: 12,
    borderRadius: 4,
    backgroundColor: theme.colors.gray[700],
    position: 'absolute',
    top: 2,
    left: 2,
  },
  teamPerson2: {
    left: 10,
  },
  // Users Icon
  usersIcon: {
    width: 16,
    height: 16,
    position: 'relative',
  },
  userIconHead: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.gray[700],
    position: 'absolute',
    top: 0,
    left: 5,
  },
  userIconBody: {
    width: 12,
    height: 8,
    borderRadius: 6,
    backgroundColor: theme.colors.gray[700],
    position: 'absolute',
    bottom: 0,
    left: 2,
  },
  // Settings Icon
  settingsIcon: {
    width: 18,
    height: 18,
    position: 'relative',
  },
  settingsIconBody: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: theme.colors.gray[700],
    position: 'absolute',
    top: 3,
    left: 3,
  },
  settingsIconTeeth: {
    width: 2,
    height: 4,
    backgroundColor: theme.colors.gray[700],
    borderRadius: 1,
    position: 'absolute',
  },
  settingsIconTeeth1: {
    top: 0,
    left: 8,
  },
  settingsIconTeeth2: {
    right: 0,
    top: 7,
  },
  settingsIconTeeth3: {
    bottom: 0,
    left: 8,
  },
  settingsIconTeeth4: {
    left: 0,
    top: 7,
  },
  // Logout Icon
  logoutIcon: {
    width: 18,
    height: 14,
    position: 'relative',
  },
  logoutIconBody: {
    width: 12,
    height: 8,
    borderRadius: 2,
    backgroundColor: theme.colors.status.error,
    position: 'absolute',
    left: 0,
    top: 3,
  },
  logoutIconHandle: {
    width: 2,
    height: 4,
    backgroundColor: theme.colors.status.error,
    borderRadius: 1,
    position: 'absolute',
    left: 10,
    top: 5,
  },
  logoutIconArrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 4,
    borderTopWidth: 3,
    borderBottomWidth: 3,
    borderLeftColor: theme.colors.status.error,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    position: 'absolute',
    right: 0,
    top: 4,
  },
  // Default Icon
  defaultIcon: {
    width: 16,
    height: 16,
    borderRadius: 2,
    backgroundColor: theme.colors.gray[700],
  },
});

export default AppNavigator;