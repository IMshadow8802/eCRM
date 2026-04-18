// Theme configuration for eCRM application
// Contains all colors, typography, spacing, and styling constants

export const theme = {
  // Primary brand colors
  colors: {
    primary: {
      brand: "#3F4FAF", // Main brand color (buttons, headers)
      brandLight: "#5A6BC0", // Lighter variant
      brandDark: "#1E34AE", // Darker variant
      secondary: "#F9629F", // Action buttons (Create, Save)
      secondaryLight: "#FF7AB7", // Hover state
      secondaryDark: "#E5558C", // Active state
    },

    // Status colors for feedback and states
    status: {
      success: "#34D399", // Green - success messages, completed items
      warning: "#FBBF24", // Yellow - warnings, pending items
      error: "#EF4444", // Red - errors, overdue items
      info: "#60A5FA", // Blue - information messages
    },

    // Priority indicators
    priority: {
      low: "#32CD32", // Light green
      medium: "#FFB347", // Orange
      high: "#FF4444", // Red
    },

    // Kanban column colors
    kanban: {
      backlog: "#A78BFA", // Purple
      todo: "#60A5FA", // Blue
      inProgress: "#FBBF24", // Yellow
      review: "#C084FC", // Light purple
      testing: "#FB7185", // Pink
      done: "#34D399", // Green
    },

    // Gray scale palette
    gray: {
      50: "#F9FAFB", // Lightest background
      100: "#F3F4F6", // Light background
      200: "#E5E7EB", // Border color
      300: "#D1D5DB", // Disabled elements
      400: "#9CA3AF", // Placeholder text
      500: "#6B7280", // Secondary text
      600: "#4B5563", // Primary text (light mode)
      700: "#374151", // Headings
      800: "#1F2937", // Dark text
      900: "#111827", // Darkest text
    },

    // Blue color palette
    blue: {
      50: "#EFF6FF",
      100: "#DBEAFE",
      200: "#BFDBFE",
      300: "#93C5FD",
      400: "#60A5FA",
      500: "#3B82F6",
      600: "#2563EB",
      700: "#1D4ED8",
      800: "#1E40AF",
      900: "#1E3A8A",
    },

    // Red color palette
    red: {
      50: "#FEF2F2",
      100: "#FEE2E2",
      200: "#FECACA",
      300: "#FCA5A5",
      400: "#F87171",
      500: "#EF4444",
      600: "#DC2626",
      700: "#B91C1C",
      800: "#991B1B",
      900: "#7F1D1D",
    },

    // Green color palette
    green: {
      50: "#F0FDF4",
      100: "#DCFCE7",
      200: "#BBF7D0",
      300: "#86EFAC",
      400: "#4ADE80",
      500: "#22C55E",
      600: "#16A34A",
      700: "#15803D",
      800: "#166534",
      900: "#14532D",
    },

    // Common colors
    white: "#FFFFFF",
    black: "#000000",
    transparent: "transparent",
  },

  // Typography system
  typography: {
    fontSizes: {
      xs: 12,
      sm: 14,
      base: 16,
      lg: 18,
      xl: 20,
      "2xl": 24,
      "3xl": 30,
      "4xl": 36,
    },

    fontWeights: {
      light: "300",
      regular: "400", // Added regular for cases where lighter weight is needed
      normal: "600", // Changed from 400 to 600 (semibold) - default weight
      medium: "500",
      semibold: "600",
      bold: "700",
      extrabold: "800",
    },

    lineHeights: {
      tight: 1.25,
      snug: 1.375,
      normal: 1.5,
      relaxed: 1.625,
      loose: 2,
    },
  },

  // Spacing system (based on 4px grid)
  spacing: {
    0: 0,
    1: 4,
    2: 8,
    3: 12,
    4: 16,
    5: 20,
    6: 24,
    7: 28,
    8: 32,
    10: 40,
    12: 48,
    16: 64,
    20: 80,
    24: 96,
    32: 128,
  },

  // Border radius values
  borderRadius: {
    none: 0,
    sm: 4,
    base: 8,
    md: 12,
    lg: 16,
    xl: 20,
    "2xl": 24,
    full: 9999,
  },

  // Shadow presets
  shadows: {
    sm: {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 2,
      elevation: 1,
    },
    base: {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
      elevation: 2,
    },
    md: {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.15,
      shadowRadius: 8,
      elevation: 4,
    },
    lg: {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.2,
      shadowRadius: 16,
      elevation: 8,
    },
  },

  // Component-specific styles
  components: {
    // Button styles
    button: {
      primary: {
        backgroundColor: "#3F4FAF",
        borderRadius: 8,
        paddingVertical: 12,
        paddingHorizontal: 16,
      },
      secondary: {
        backgroundColor: "#F9629F",
        borderRadius: 8,
        paddingVertical: 12,
        paddingHorizontal: 16,
      },
      ghost: {
        backgroundColor: "transparent",
        borderWidth: 1,
        borderColor: "#3F4FAF",
        borderRadius: 8,
        paddingVertical: 12,
        paddingHorizontal: 16,
      },
      outline: {
        backgroundColor: "transparent",
        borderWidth: 1,
        borderColor: "#D1D5DB",
        borderRadius: 8,
        paddingVertical: 12,
        paddingHorizontal: 16,
      },
    },

    // Input styles
    input: {
      base: {
        borderWidth: 1,
        borderColor: "#D1D5DB",
        borderRadius: 12,
        paddingVertical: 12,
        paddingHorizontal: 16,
        fontSize: 16,
        backgroundColor: "#FFFFFF",
      },
      focused: {
        borderColor: "#3F4FAF",
        borderWidth: 2,
      },
      error: {
        borderColor: "#EF4444",
      },
    },

    // Card styles
    card: {
      base: {
        backgroundColor: "#FFFFFF",
        borderRadius: 12,
        padding: 16,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
      },
      elevated: {
        backgroundColor: "#FFFFFF",
        borderRadius: 12,
        padding: 20,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
        elevation: 4,
      },
    },

    // Statistics card styles
    statsCard: {
      totalTasks: {
        color: "#3F4FAF",
        backgroundColor: "#F0F4FF",
      },
      completed: {
        color: "#34D399",
        backgroundColor: "#ECFDF5",
      },
      inProgress: {
        color: "#FBBF24",
        backgroundColor: "#FFFBEB",
      },
      overdue: {
        color: "#EF4444",
        backgroundColor: "#FEF2F2",
      },
    },
  },
};

// Helper functions for theme usage
export const getColorByPriority = (priority) => {
  const priorityColors = {
    low: theme.colors.priority.low,
    medium: theme.colors.priority.medium,
    high: theme.colors.priority.high,
  };
  return priorityColors[priority] || theme.colors.gray[500];
};

export const getColorByStatus = (status) => {
  const statusColors = {
    success: theme.colors.status.success,
    warning: theme.colors.status.warning,
    error: theme.colors.status.error,
    info: theme.colors.status.info,
  };
  return statusColors[status] || theme.colors.gray[500];
};

export const getKanbanColumnColor = (columnId) => {
  const columnColors = {
    backlog: theme.colors.kanban.backlog,
    todo: theme.colors.kanban.todo,
    "in-progress": theme.colors.kanban.inProgress,
    inprogress: theme.colors.kanban.inProgress,
    review: theme.colors.kanban.review,
    testing: theme.colors.kanban.testing,
    done: theme.colors.kanban.done,
  };
  return columnColors[columnId] || theme.colors.gray[500];
};

export const getProgressColor = (progress) => {
  if (progress >= 100) return theme.colors.status.success;
  if (progress >= 75) return theme.colors.status.warning;
  if (progress >= 50) return theme.colors.status.info;
  if (progress >= 25) return theme.colors.priority.medium;
  return theme.colors.status.error;
};

export default theme;
