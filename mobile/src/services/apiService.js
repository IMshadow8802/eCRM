import axios from 'axios';
import { useAuthStore } from '../stores/authStore';

// API Configuration based on migration document
const API_CONFIG = {
  baseURL: 'https://prdinfotech.in/CRM',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json'
  }
};

// Create axios instance
const apiClient = axios.create(API_CONFIG);

// Request interceptor to add auth token
apiClient.interceptors.request.use(
  (config) => {
    const { token } = useAuthStore.getState();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
apiClient.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    const { logout } = useAuthStore.getState();
    
    // Handle 401 unauthorized - token expired
    if (error.response?.status === 401) {
      logout();
    }
    
    return Promise.reject(error);
  }
);

// API endpoints based on migration document
export const authAPI = {
  login: (credentials) => 
    apiClient.post('/api/auth/loginUser', credentials),
  
  logout: () => 
    apiClient.post('/api/auth/logoutUser')
};

export const dashboardAPI = {
  getStats: () => 
    apiClient.post('/api/dashboard/stats')
};

export const tasksAPI = {
  fetch: (params = { Id: 0, PageNumber: 1, PageSize: 100 }) => 
    apiClient.post('/api/tasks/fetchTasks', params),
  
  save: (taskData) => 
    apiClient.post('/api/tasks/saveTask', taskData),
  
  delete: (taskId) => 
    apiClient.post('/api/tasks/deleteTask', { Id: taskId })
};

export const projectsAPI = {
  fetch: (params = { Id: 0, PageNumber: 1, PageSize: 100 }) => 
    apiClient.post('/api/projects/fetchProjects', params),
  
  save: (projectData) => 
    apiClient.post('/api/projects/saveProject', projectData),
  
  delete: (projectId) => 
    apiClient.post('/api/projects/deleteProject', { Id: projectId })
};

export const teamsAPI = {
  fetch: (params = { Id: 0, PageNumber: 1, PageSize: 100 }) => 
    apiClient.post('/api/teams/fetchTeams', params),
  
  save: (teamData) => 
    apiClient.post('/api/teams/saveTeam', teamData),
  
  delete: (teamId) => 
    apiClient.post('/api/teams/deleteTeam', { Id: teamId })
};

export const usersAPI = {
  fetch: (params = { Id: 0, PageNumber: 1, PageSize: 100 }) => 
    apiClient.post('/api/users/fetchUsers', params),
  
  save: (userData) => 
    apiClient.post('/api/users/saveUser', userData),
  
  delete: (userId) => 
    apiClient.post('/api/users/deleteUser', { Id: userId })
};

export const kanbanAPI = {
  fetch: () => 
    apiClient.post('/api/kanban/fetchKanbanColumns'),
  
  save: (columnData) => 
    apiClient.post('/api/kanban/saveKanbanColumn', columnData),
  
  delete: (columnId) => 
    apiClient.post('/api/kanban/deleteKanbanColumn', { Id: columnId })
};

export default apiClient;