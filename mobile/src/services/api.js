import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

const BASE_URL = 'https://prdinfotech.in/CRM';

// Create axios instance
const apiClient = axios.create({
  baseURL: BASE_URL,
  timeout: 30000, // 30 seconds timeout
  headers: {
    'Content-Type': 'application/json',
  },
});

// Token management
const getAuthToken = async () => {
  try {
    const token = await AsyncStorage.getItem('authToken');
    return token;
  } catch (error) {
    console.error('Error getting auth token:', error);
    return null;
  }
};

const setAuthToken = async (token) => {
  try {
    await AsyncStorage.setItem('authToken', token);
    // Set default auth header for all future requests
    apiClient.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  } catch (error) {
    console.error('Error setting auth token:', error);
  }
};

const clearAuthToken = async () => {
  try {
    await AsyncStorage.removeItem('authToken');
    await AsyncStorage.removeItem('userData');
    // Remove auth header
    delete apiClient.defaults.headers.common['Authorization'];
  } catch (error) {
    console.error('Error clearing auth token:', error);
  }
};

// Request interceptor to add token to requests
apiClient.interceptors.request.use(
  async (config) => {
    const token = await getAuthToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor to handle token expiry
apiClient.interceptors.response.use(
  (response) => {
    return response;
  },
  async (error) => {
    const originalRequest = error.config;

    // Handle token expiry (401 Unauthorized)
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      
      // Clear stored token and redirect to login
      await clearAuthToken();
      
      // You can add navigation to login screen here if needed
      // For now, just throw the error
      throw new Error('Session expired. Please login again.');
    }

    // Handle other errors
    if (error.response?.data) {
      throw new Error(error.response.data.message || 'API call failed');
    }
    
    throw error;
  }
);

// Generic API call function
const apiCall = async (endpoint, payload = {}, method = 'POST') => {
  try {
    const response = await apiClient.request({
      url: endpoint,
      method,
      data: payload,
    });

    const data = response.data;
    
    // Handle your API response format: {success, message, responseCode, data, timestamp}
    if (!data.success) {
      throw new Error(data.message || 'API call failed');
    }
    
    // Return the data object with proper null handling
    return {
      ...data,
      data: data.data || {} // Ensure data property always exists
    };
  } catch (error) {
    console.error(`API Error (${endpoint}):`, error.message);
    throw error;
  }
};

// User Management APIs
export const userAPI = {
  // Fetch all users - matches corrected API documentation
  fetchUsers: async (searchTerm = null) => {
    const payload = {
      Id: 0,
      PageNumber: 1,
      PageSize: 100, // Increase page size to get all users
      SearchTerm: searchTerm
    };
    
    const response = await apiCall('/api/users/fetchUsers', payload);
    return response.data?.users || [];
  },

  // Create or update user - matches corrected API documentation
  saveUser: async (userData) => {
    // Map to correct field names based on corrected API docs
    const apiPayload = {
      Id: userData.Id || 0,
      Username: userData.Username,
      FullName: userData.FullName,
      Email: userData.Email,
      JobTitle: userData.JobTitle,
      HourlyRate: userData.HourlyRate || 0,
      GroupId: userData.GroupId,
      AllowDay: userData.AllowDay || 0,
      User_IP: userData.User_IP || '',
      UserActive: userData.UserActive,
      IsAdmin: userData.IsAdmin,
      CompId: userData.CompId || 1,
      BranchId: userData.BranchId || 1
    };
    
    // Only include password for create or when updating password
    if (userData.Password) {
      apiPayload.Password = userData.Password;
    }
    
    const response = await apiCall('/api/users/saveUser', apiPayload);
    return response.data;
  },

  // Delete user - proper delete endpoint
  deleteUser: async (userId) => {
    const payload = {
      Id: userId
    };
    
    const response = await apiCall('/api/users/deleteUser', payload);
    return response;
  }
};

// User Groups API
export const userGroupAPI = {
  // Fetch all user groups for dropdown - matches corrected API documentation
  fetchUserGroups: async () => {
    const payload = { Id: 0 };
    
    const response = await apiCall('/api/user-groups/fetchUserGroups', payload);
    return response.data?.userGroups || [];
  }
};

// Authentication APIs
export const authAPI = {
  // Login
  login: async (username, password) => {
    const payload = {
      username,
      password
    };
    
    const response = await apiCall('/api/auth/loginUser', payload);
    
    // Store token for future API calls
    if (response.data.token) {
      await AsyncStorage.setItem('authToken', response.data.token);
      await AsyncStorage.setItem('userData', JSON.stringify(response.data.user));
    }
    
    return response.data;
  },

  // Logout
  logout: async () => {
    const response = await apiCall('/api/auth/logoutUser', {});
    
    // Clear stored data
    await AsyncStorage.removeItem('authToken');
    await AsyncStorage.removeItem('userData');
    
    return response;
  }
};

// Dashboard APIs
export const dashboardAPI = {
  // Get dashboard stats
  getStats: async (startDate, endDate) => {
    const payload = {
      Id: 0,
      DateRange: {
        startDate,
        endDate
      }
    };
    
    const response = await apiCall('/api/dashboard/stats', payload);
    return response.data;
  }
};

// Task Management APIs - matches corrected API documentation
export const taskAPI = {
  // Fetch tasks with filtering options
  fetchTasks: async (searchTerm = null, projectId = null, assignedToUserId = null, teamId = null, status = null, priority = null) => {
    const payload = {
      Id: 0,
      PageNumber: 1,
      PageSize: 100,
      SearchTerm: searchTerm
    };
    
    // Add filters if provided
    if (projectId) payload.ProjectId = projectId;
    if (assignedToUserId) payload.AssignedToUserId = assignedToUserId;
    if (teamId) payload.TeamId = teamId;
    if (status) payload.Status = status;
    if (priority) payload.Priority = priority;
    
    const response = await apiCall('/api/tasks/fetchTasks', payload);
    return response.data?.tasks || [];
  },

  // Save task (create or update)
  saveTask: async (taskData) => {
    // Map to correct field names based on corrected API docs
    const apiPayload = {
      Id: taskData.Id || 0,
      Title: taskData.Title,
      Description: taskData.Description || '',
      ProjectId: taskData.ProjectId,
      AssignedToUserId: taskData.AssignedToUserId,
      TeamId: taskData.TeamId,
      Priority: taskData.Priority, // low, medium, high
      Type: taskData.Type || 'task',
      Status: taskData.Status || 'todo',
      DueDate: taskData.DueDate,
      EstimatedHours: taskData.EstimatedHours || 0,
      LoggedHours: taskData.LoggedHours || 0,
      Progress: taskData.Progress || 0,
      IsBlocked: taskData.IsBlocked || false,
      Labels: taskData.Labels || '[]',
      Watchers: taskData.Watchers || '[]',
      Dependencies: taskData.Dependencies || '[]'
    };
    
    const response = await apiCall('/api/tasks/saveTask', apiPayload);
    // Check if response contains full task object or just taskId
    if (response.data && response.data.taskId) {
      // API returned just taskId, return the original payload with updated Id
      return { ...apiPayload, Id: response.data.taskId };
    }
    return response.data.task || response.data;
  },

  // Delete task
  deleteTask: async (taskId) => {
    const payload = {
      Id: taskId
    };
    
    const response = await apiCall('/api/tasks/deleteTask', payload);
    return response;
  },

  // Fetch comments for a task
  fetchComments: async (taskId) => {
    const payload = {
      TaskId: taskId
    };
    
    const response = await apiCall('/api/tasks/getTaskComments', payload);
    return response.data?.comments || [];
  },

  // Add comment to a task
  addComment: async (taskId, comment, userId) => {
    const payload = {
      TaskId: taskId,
      Comment: comment,
      UserId: userId
    };
    
    const response = await apiCall('/api/tasks/addTaskComment', payload);
    return response;
  },

  // Fetch time entries for a task
  fetchTimeEntries: async (taskId) => {
    const payload = {
      TaskId: taskId
    };
    
    const response = await apiCall('/api/tasks/getTaskTimeEntries', payload);
    return response.data?.timeEntries || [];
  },

  // Log time for a task
  logTime: async (taskId, hours, description) => {
    const payload = {
      TaskId: taskId,
      Hours: parseFloat(hours),
      Description: description || "Work logged",
      WorkDate: new Date().toISOString().split("T")[0] // Always today's date
    };
    
    const response = await apiCall('/api/tasks/logTaskTime', payload);
    return response;
  },

  // Delete comment
  deleteComment: async (commentId) => {
    const payload = {
      Id: commentId
    };
    
    const response = await apiCall('/api/tasks/deleteTaskComment', payload);
    return response;
  },

  // Delete time entry
  deleteTimeEntry: async (timeEntryId) => {
    const payload = {
      Id: timeEntryId
    };
    
    const response = await apiCall('/api/tasks/deleteTaskTimeEntry', payload);
    return response;
  },

  // Fetch checklist for a task
  fetchChecklist: async (taskId) => {
    const payload = {
      TaskId: taskId
    };
    
    const response = await apiCall('/api/tasks/getTaskChecklist', payload);
    return response.data.checklist || [];
  },

  // Save checklist item (create or update)
  saveChecklist: async (taskId, itemId, itemText, isCompleted, sortOrder) => {
    const payload = {
      Id: itemId || 0,
      TaskId: taskId,
      ItemText: itemText,
      IsCompleted: isCompleted,
      SortOrder: sortOrder || 0
    };
    
    const response = await apiCall('/api/tasks/saveTaskChecklist', payload);
    return response;
  },

  // Delete checklist item
  deleteChecklist: async (checklistItemId) => {
    const payload = {
      Id: checklistItemId
    };
    
    const response = await apiCall('/api/tasks/deleteTaskChecklist', payload);
    return response;
  }
};

// Project Management APIs - matches corrected API documentation
export const projectAPI = {
  // Fetch projects
  fetchProjects: async (searchTerm = null) => {
    const payload = {
      Id: 0,
      PageNumber: 1,
      PageSize: 100,
      SearchTerm: searchTerm
    };
    
    const response = await apiCall('/api/projects/fetchProjects', payload);
    return response.data?.projects || [];
  },

  // Save project (create or update)
  saveProject: async (projectData) => {
    // Map to exact field names from API docs
    const apiPayload = {
      Id: projectData.Id || 0,
      Name: projectData.Name,
      Description: projectData.Description || '',
      ManagerUserId: projectData.ManagerUserId,
      TeamId: projectData.TeamId || null,
      Members: projectData.Members || '[]',
      Status: projectData.Status || 'active',
      Priority: projectData.Priority || 'medium',
      StartDate: projectData.StartDate || null,
      EndDate: projectData.EndDate || null,
      Budget: projectData.Budget || 0,
      Progress: projectData.Progress || 0,
      BranchId: projectData.BranchId || 1,
      CompId: projectData.CompId || 1
    };
    
    const response = await apiCall('/api/projects/saveProject', apiPayload);
    return response.data;
  },

  // Delete project
  deleteProject: async (projectId) => {
    const payload = {
      Id: projectId
    };
    
    const response = await apiCall('/api/projects/deleteProject', payload);
    return response;
  }
};

// Team Management APIs - matches corrected API documentation
export const teamAPI = {
  // Fetch teams
  fetchTeams: async (searchTerm = null) => {
    const payload = {
      Id: 0,
      PageNumber: 1,
      PageSize: 100,
      SearchTerm: searchTerm
    };
    
    const response = await apiCall('/api/teams/fetchTeams', payload);
    return response.data?.teams || [];
  },

  // Save team (create or update)
  saveTeam: async (teamData) => {
    // Map to correct field names
    const apiPayload = {
      Id: teamData.Id || 0,
      Name: teamData.Name,
      Description: teamData.Description || '',
      LeadUserId: teamData.LeadUserId,
      Color: teamData.Color || '#3B82F6',
      Members: teamData.Members || [],
      IsActive: teamData.IsActive !== false,
      BranchId: teamData.BranchId || 1,
      CompId: teamData.CompId || 1
    };
    
    const response = await apiCall('/api/teams/saveTeam', apiPayload);
    return response.data;
  },

  // Delete team
  deleteTeam: async (teamId) => {
    const payload = {
      Id: teamId
    };
    
    const response = await apiCall('/api/teams/deleteTeam', payload);
    return response;
  }
};

// Kanban APIs - matches new API documentation structure
export const kanbanAPI = {
  // Fetch kanban columns with optional project filtering
  fetchColumns: async (projectId = null) => {
    const payload = {
      Id: 0, // 0 = fetch all columns
      ProjectId: projectId // Optional project filter
    };
    
    const response = await apiCall('/api/kanban/fetchKanbanColumns', payload);
    return response.data?.columns || [];
  },

  // Save kanban column (create or update)
  saveColumn: async (columnData) => {
    // Map to exact field names from new API docs
    const apiPayload = {
      Id: columnData.Id || 0, // 0 = create new, >0 = update existing
      ProjectId: columnData.ProjectId, // Required - Project ID
      Title: columnData.Title, // Required - Column title
      Color: columnData.Color || '#3B82F6', // Optional - Hex color
      SortOrder: columnData.SortOrder || 0, // Optional - Auto-assigned if 0
      MaxTasks: columnData.MaxTasks || null, // Optional - Max tasks allowed
      IsActive: columnData.IsActive !== false // Optional - Default true
    };
    
    const response = await apiCall('/api/kanban/saveKanbanColumn', apiPayload);
    return response.data;
  },

  // Delete kanban column
  deleteColumn: async (columnId) => {
    const payload = {
      Id: columnId // Required - Column ID to delete
    };
    
    const response = await apiCall('/api/kanban/deleteKanbanColumn', payload);
    return response;
  }
};

export default {
  userAPI,
  userGroupAPI, 
  authAPI,
  dashboardAPI,
  taskAPI,
  projectAPI,
  teamAPI,
  kanbanAPI
};