import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import BottomSheetModal from './BottomSheetModal';
import FormField from './FormField';
import SelectField from './SelectField';
import DateField from './DateField';
import Button from './Button';
import Dialog from './Dialog';
import { EditIcon, DeleteIcon } from './Icons';
import { theme } from '../constants/theme';
import { taskAPI, userAPI, projectAPI, teamAPI } from '../services/api';
import { useAuthStore } from '../stores/authStore';

const TaskModal = ({
  visible,
  task,
  onClose,
  onTaskUpdated,
  kanbanColumns = [],
  permissions = {}
}) => {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  
  // State
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [editMode, setEditMode] = useState(false);
  const [currentTask, setCurrentTask] = useState(task);
  const [editedTask, setEditedTask] = useState(task);
  
  // Data state
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [teams, setTeams] = useState([]);
  const [comments, setComments] = useState([]);
  const [timeEntries, setTimeEntries] = useState([]);
  const [checklist, setChecklist] = useState([]);
  
  // New comment/time/checklist state
  const [newComment, setNewComment] = useState('');
  const [newTimeHours, setNewTimeHours] = useState('');
  const [newTimeDescription, setNewTimeDescription] = useState('');
  const [newChecklistItem, setNewChecklistItem] = useState('');

  // Dialog state
  const [dialogVisible, setDialogVisible] = useState(false);
  const [dialogConfig, setDialogConfig] = useState({});

  const showDialog = (config) => {
    setDialogConfig(config);
    setDialogVisible(true);
  };

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'comments', label: 'Comments' },
    { key: 'checklist', label: 'Checklist' },
    { key: 'timeTracking', label: 'Time' },
  ];

  // Check if current user is task creator  
  const isTaskCreator = currentTask?.CreatedByUserId === user?.userid;
  const canEdit = isTaskCreator; // Only task creator can edit

  // Load task data
  const loadTaskData = async () => {
    if (!task?.Id) return;
    
    setLoading(true);
    try {
      // Parallel API calls for all data
      const [
        usersResponse,
        projectsResponse,
        teamsResponse,
        commentsResponse,
        timeEntriesResponse,
        checklistResponse
      ] = await Promise.all([
        userAPI.fetchUsers(),
        projectAPI.fetchProjects(),
        teamAPI.fetchTeams(),
        taskAPI.fetchComments(task.Id),
        taskAPI.fetchTimeEntries(task.Id),
        taskAPI.fetchChecklist(task.Id)
      ]);

      setUsers(usersResponse || []);
      setProjects(projectsResponse || []);
      setTeams(teamsResponse || []);
      
      // Filter out empty comments
      setComments((commentsResponse || []).filter(comment => 
        comment.Comment && comment.Comment.trim() !== ''
      ));
      
      // Filter valid time entries
      setTimeEntries((timeEntriesResponse || []).filter(entry => 
        entry.Hours && parseFloat(entry.Hours) > 0
      ));
      
      // Filter valid checklist items
      setChecklist((checklistResponse || []).filter(item => 
        item.ItemText && item.ItemText.trim() !== ''
      ));

    } catch (error) {
      console.error('Error loading task data:', error);
      showDialog({
        type: 'error',
        title: 'Error',
        message: 'Failed to load task data'
      });
    } finally {
      setLoading(false);
    }
  };

  // Delete task
  const deleteTask = async () => {

    if (!isTaskCreator) {
      showDialog({
        type: 'warning',
        title: 'Permission Denied',
        message: `You can only delete tasks you created. Task creator: ${currentTask?.CreatedByUserId}, Your ID: ${user?.userid}`
      });
      return;
    }

    showDialog({
      type: 'confirmation',
      title: 'Delete Task',
      message: 'Are you sure you want to delete this task? This action cannot be undone.',
      showCancel: true,
      confirmText: 'Delete',
      onConfirm: async () => {
        try {
          await taskAPI.deleteTask(currentTask.Id);
          
          // Invalidate queries to refresh the task list
          queryClient.invalidateQueries({ queryKey: ['tasks'] });
          
          showDialog({
            type: 'success',
            title: 'Success',
            message: 'Task deleted successfully',
            onConfirm: () => {
              // Close modal after successful deletion
              onClose();
            }
          });
          
        } catch (error) {
          console.error('Error deleting task:', error);
          showDialog({
            type: 'error',
            title: 'Error',
            message: 'Failed to delete task'
          });
        }
      }
    });
  };

  // Update task
  const saveTask = async () => {
    if (!isTaskCreator) {
      showDialog({
        type: 'warning',
        title: 'Permission Denied',
        message: 'You can only edit tasks you created'
      });
      return;
    }

    setSaving(true);
    try {
      // Clean task payload
      const cleanedTask = {
        Id: parseInt(editedTask.Id),
        Title: editedTask.Title,
        Description: editedTask.Description,
        ProjectId: parseInt(editedTask.ProjectId),
        ProjectName: editedTask.ProjectName,
        ParentTaskId: editedTask.ParentTaskId ? parseInt(editedTask.ParentTaskId) : null,
        AssignedToUserId: parseInt(editedTask.AssignedToUserId),
        AssigneeName: editedTask.AssigneeName,
        CreatedByUserId: parseInt(editedTask.CreatedByUserId),
        CreatorName: editedTask.CreatorName,
        TeamId: editedTask.TeamId ? parseInt(editedTask.TeamId) : null,
        TeamName: editedTask.TeamName,
        Priority: editedTask.Priority,
        Type: editedTask.Type,
        Status: editedTask.Status,
        DueDate: editedTask.DueDate,
        EstimatedHours: parseFloat(editedTask.EstimatedHours) || 0,
        LoggedHours: parseFloat(editedTask.LoggedHours) || 0,
        Progress: parseFloat(editedTask.Progress) || 0,
        IsBlocked: editedTask.IsBlocked,
        Labels: editedTask.Labels,
        Watchers: editedTask.Watchers,
        Dependencies: editedTask.Dependencies,
        SubTaskCount: editedTask.SubTaskCount
      };

      const updatedTask = await taskAPI.saveTask(cleanedTask);
      
      // Update local state
      setCurrentTask(updatedTask);
      setEditedTask(updatedTask);
      setEditMode(false);
      
      // Invalidate cache
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["kanbanTasks"] });
      
      // Notify parent
      if (onTaskUpdated) {
        onTaskUpdated(updatedTask);
      }

      showDialog({
        type: 'success',
        title: 'Success',
        message: 'Task updated successfully'
      });

    } catch (error) {
      console.error('Error saving task:', error);
      showDialog({
        type: 'error',
        title: 'Error',
        message: 'Failed to save task'
      });
    } finally {
      setSaving(false);
    }
  };

  // Initialize data when modal opens
  useEffect(() => {
    if (visible && task?.Id) {
      setCurrentTask(task);
      setEditedTask(task);
      setEditMode(false);
      setActiveTab('overview');
      loadTaskData();
    }
  }, [visible, task]);

  const renderTabButton = (tab) => (
    <TouchableOpacity
      key={tab.key}
      style={styles.tabButton}
      onPress={() => setActiveTab(tab.key)}
    >
      <Text style={[
        styles.tabLabel,
        activeTab === tab.key && styles.activeTabLabel
      ]}>
        {tab.label}
      </Text>
      {activeTab === tab.key && <View style={styles.tabUnderline} />}
    </TouchableOpacity>
  );

  const renderTabContent = () => {
    if (loading) {
      return (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.colors.primary.brand} />
          <Text style={styles.loadingText}>Loading task data...</Text>
        </View>
      );
    }

    switch (activeTab) {
      case 'overview':
        return renderOverviewTab();
      case 'comments':
        return renderCommentsTab();
      case 'checklist':
        return renderChecklistTab();
      case 'timeTracking':
        return renderTimeTrackingTab();
      default:
        return null;
    }
  };

  const renderOverviewTab = () => {
    // Get assignee options based on team filtering
    const getAssigneeOptions = () => {
      if (!currentTask?.TeamId) {
        // Show all users if no team
        return users.map(user => ({
          value: user.UserId?.toString() || user.userid?.toString(),
          label: user.FullName || user.username
        }));
      }

      // Filter users by team
      const selectedTeam = teams.find(team => team.Id == currentTask.TeamId);
      if (!selectedTeam?.Members) {
        return [];
      }

      const teamMemberIds = selectedTeam.Members.map(member => member.UserId);
      const teamUsers = users.filter(u => teamMemberIds.includes(u.userid));
      
      return teamUsers.map(user => ({
        value: user.userid.toString(),
        label: user.username
      }));
    };

    // Get status options from kanban columns
    const getStatusOptions = () => {
      return kanbanColumns
        .filter(column => column.IsActive)
        .map(column => ({
          value: column.Id,
          label: column.Title
        }));
    };

    // Priority options
    const priorityOptions = [
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' }
    ];

    return (
      <View style={styles.tabContent}>
        {/* Task Information */}
        <View style={styles.section}>
          <View style={styles.sectionTitle}>
            <Text style={styles.sectionTitleText}>Task Information</Text>
          </View>
          
          {/* Title */}
          <FormField
            label="Title"
            value={editMode ? editedTask?.Title : currentTask?.Title}
            onChangeText={(text) => 
              editMode && setEditedTask({...editedTask, Title: text})
            }
            editable={editMode}
            required
          />

          {/* Description */}
          <FormField
            label="Description"
            value={editMode ? editedTask?.Description : currentTask?.Description}
            onChangeText={(text) => 
              editMode && setEditedTask({...editedTask, Description: text})
            }
            multiline
            numberOfLines={4}
            editable={editMode}
          />
        </View>

        {/* Assignment & Status */}
        <View style={styles.section}>
          <View style={styles.sectionTitle}>
            <Text style={styles.sectionTitleText}>Assignment & Status</Text>
          </View>
          
          {/* Status */}
          <SelectField
            label="Status"
            value={editMode ? editedTask?.Status : currentTask?.Status}
            onSelect={(value) => 
              editMode && setEditedTask({...editedTask, Status: value})
            }
            options={getStatusOptions()}
            disabled={!editMode}
          />

          {/* Priority */}
          <SelectField
            label="Priority"
            value={editMode ? editedTask?.Priority : currentTask?.Priority}
            onSelect={(value) => 
              editMode && setEditedTask({...editedTask, Priority: value})
            }
            options={priorityOptions}
            disabled={!editMode}
          />

          {/* Assignee */}
          <SelectField
            label="Assignee"
            value={editMode ? editedTask?.AssignedToUserId?.toString() : currentTask?.AssignedToUserId?.toString()}
            onSelect={(value) => {
              if (editMode) {
                const selectedUser = users.find(u => 
                  u.UserId?.toString() === value || u.userid?.toString() === value
                );
                setEditedTask({
                  ...editedTask, 
                  AssignedToUserId: parseInt(value),
                  AssigneeName: selectedUser?.FullName || selectedUser?.username
                });
              }
            }}
            options={getAssigneeOptions()}
            disabled={!editMode}
          />
        </View>

        {/* Timeline & Progress */}
        <View style={styles.section}>
          <View style={styles.sectionTitle}>
            <Text style={styles.sectionTitleText}>Timeline & Progress</Text>
          </View>
          
          {/* Due Date */}
          <DateField
            label="Due Date"
            value={editMode ? editedTask?.DueDate : currentTask?.DueDate}
            onChange={(date) => 
              editMode && setEditedTask({...editedTask, DueDate: date})
            }
            disabled={!editMode}
          />

          {/* Estimated Hours */}
          <FormField
            label="Estimated Hours"
            value={editMode ? editedTask?.EstimatedHours?.toString() : currentTask?.EstimatedHours?.toString()}
            onChangeText={(text) => 
              editMode && setEditedTask({...editedTask, EstimatedHours: parseFloat(text) || 0})
            }
            keyboardType="numeric"
            editable={editMode}
          />

          {/* Progress */}
          <FormField
            label="Progress (%)"
            value={editMode ? editedTask?.Progress?.toString() : currentTask?.Progress?.toString()}
            onChangeText={(text) => {
              if (editMode) {
                const progress = Math.min(100, Math.max(0, parseFloat(text) || 0));
                setEditedTask({...editedTask, Progress: progress});
              }
            }}
            keyboardType="numeric"
            editable={editMode}
          />
        </View>

        {/* Task Details */}
        <View style={styles.section}>
          <View style={styles.sectionTitle}>
            <Text style={styles.sectionTitleText}>Task Details</Text>
          </View>
          
          {/* Task ID */}
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Task ID:</Text>
            <Text style={styles.infoValue}>#{currentTask?.Id}</Text>
          </View>

          {/* Project */}
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Project:</Text>
            <Text style={styles.infoValue}>{currentTask?.ProjectName}</Text>
          </View>

          {/* Team */}
          {currentTask?.TeamName && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Team:</Text>
              <Text style={styles.infoValue}>{currentTask?.TeamName}</Text>
            </View>
          )}

          {/* Creator */}
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Created by:</Text>
            <Text style={styles.infoValue}>{currentTask?.CreatorName}</Text>
          </View>

          {/* Logged Hours */}
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Logged Hours:</Text>
            <Text style={styles.infoValue}>{currentTask?.LoggedHours || 0}h</Text>
          </View>
        </View>

        {/* Edit Mode Actions */}
        {editMode && isTaskCreator && (
          <View style={styles.editActions}>
            <Button
              title="Cancel"
              onPress={() => {
                setEditMode(false);
                setEditedTask(currentTask);
              }}
              variant="secondary"
              style={styles.cancelButton}
            />
            <Button
              title={saving ? "Saving..." : "Save Changes"}
              onPress={saveTask}
              loading={saving}
              disabled={saving}
              variant="primary"
              style={styles.saveButton}
            />
          </View>
        )}
      </View>
    );
  };

  const renderCommentsTab = () => {
    const addComment = async () => {
      if (!newComment.trim()) {
        showDialog({
          type: 'error',
          title: 'Error',
          message: 'Please enter a comment'
        });
        return;
      }

      try {
        await taskAPI.addComment(currentTask.Id, newComment.trim(), user.userid);
        
        // Refresh comments
        const updatedComments = await taskAPI.fetchComments(currentTask.Id);
        setComments(updatedComments.filter(comment => 
          comment.Comment && comment.Comment.trim() !== ''
        ));
        
        setNewComment('');
        showDialog({
          type: 'success',
          title: 'Success',
          message: 'Comment added successfully'
        });
        
      } catch (error) {
        console.error('Error adding comment:', error);
        showDialog({
          type: 'error',
          title: 'Error',
          message: 'Failed to add comment'
        });
      }
    };

    const deleteComment = async (commentId) => {
      showDialog({
        type: 'confirmation',
        title: 'Delete Comment',
        message: 'Are you sure you want to delete this comment?',
        showCancel: true,
        confirmText: 'Delete',
        onConfirm: async () => {
          try {
            await taskAPI.deleteComment(commentId);
            
            // Refresh comments
            const updatedComments = await taskAPI.fetchComments(currentTask.Id);
            setComments(updatedComments.filter(comment => 
              comment.Comment && comment.Comment.trim() !== ''
            ));
            
            showDialog({
              type: 'success',
              title: 'Success',
              message: 'Comment deleted successfully'
            });
            
          } catch (error) {
            console.error('Error deleting comment:', error);
            showDialog({
              type: 'error',
              title: 'Error',
              message: 'Failed to delete comment'
            });
          }
        }
      });
    };

    const formatCommentDate = (dateString) => {
      if (!dateString) return '';
      
      const date = new Date(dateString);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / (1000 * 60));
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays < 7) return `${diffDays}d ago`;
      
      return date.toLocaleDateString();
    };

    return (
      <View style={styles.tabContent}>
        {/* Add Comment Section */}
        <View style={styles.addCommentSection}>
          <View style={styles.sectionTitle}>
            <Text style={styles.sectionTitleText}>Add Comment</Text>
          </View>
          
          <View style={styles.commentInputContainer}>
            <TextInput
              style={styles.commentInput}
              value={newComment}
              onChangeText={setNewComment}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
            <Button
              title="Post"
              onPress={addComment}
              disabled={!newComment.trim()}
              variant="primary"
              style={styles.addCommentButton}
            />
          </View>
        </View>

        {/* Comments List */}
        <View style={styles.commentsSection}>
          <View style={styles.sectionTitle}>
            <Text style={styles.sectionTitleText}>
              Comments ({comments.length})
            </Text>
          </View>
          
          {comments.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>No comments yet</Text>
              <Text style={styles.emptyStateSubtext}>
                Be the first to add a comment!
              </Text>
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              {comments.map((comment) => {
                const isOwnComment = comment.UserId === user.userid;
                
                return (
                  <View key={comment.Id} style={styles.commentCard}>
                    <View style={styles.commentHeader}>
                      <View style={styles.commentAuthor}>
                        <View style={styles.commentAvatar}>
                          <Text style={styles.commentAvatarText}>
                            {(comment.UserName || comment.FullName || '?').charAt(0)}
                          </Text>
                        </View>
                        <View style={styles.commentInfo}>
                          <Text style={styles.commentUserName}>
                            {comment.UserName || comment.FullName || 'Unknown User'}
                          </Text>
                          <Text style={styles.commentDate}>
                            {formatCommentDate(comment.CreatedAt || comment.DateCreated)}
                          </Text>
                        </View>
                      </View>
                      
                      {isOwnComment && (
                        <TouchableOpacity
                          style={styles.deleteCommentButton}
                          onPress={() => deleteComment(comment.Id)}
                        >
                          <DeleteIcon size={16} />
                        </TouchableOpacity>
                      )}
                    </View>
                    
                    <Text style={styles.commentText}>
                      {comment.Comment}
                    </Text>
                  </View>
                );
              })}
            </ScrollView>
          )}
        </View>
      </View>
    );
  };

  const renderChecklistTab = () => {
    const addChecklistItem = async () => {
      if (!newChecklistItem.trim()) {
        showDialog({
          type: 'error',
          title: 'Error',
          message: 'Please enter a checklist item'
        });
        return;
      }

      try {
        await taskAPI.saveChecklist(
          currentTask.Id,
          0, // New item ID
          newChecklistItem.trim(),
          false, // Not completed
          checklist.length + 1 // Sort order
        );
        
        // Refresh checklist
        const updatedChecklist = await taskAPI.fetchChecklist(currentTask.Id);
        setChecklist(updatedChecklist.filter(item => 
          item.ItemText && item.ItemText.trim() !== ''
        ));
        
        setNewChecklistItem('');
        showDialog({
          type: 'success',
          title: 'Success',
          message: 'Checklist item added successfully'
        });
        
      } catch (error) {
        console.error('Error adding checklist item:', error);
        showDialog({
          type: 'error',
          title: 'Error',
          message: 'Failed to add checklist item'
        });
      }
    };

    const toggleChecklistItem = async (item) => {
      try {
        await taskAPI.saveChecklist(
          currentTask.Id,
          item.Id,
          item.ItemText,
          !item.IsCompleted, // Toggle completion
          item.SortOrder
        );
        
        // Refresh checklist
        const updatedChecklist = await taskAPI.fetchChecklist(currentTask.Id);
        setChecklist(updatedChecklist.filter(checklistItem => 
          checklistItem.ItemText && checklistItem.ItemText.trim() !== ''
        ));
        
      } catch (error) {
        console.error('Error updating checklist item:', error);
        showDialog({
          type: 'error',
          title: 'Error',
          message: 'Failed to update checklist item'
        });
      }
    };

    const deleteChecklistItem = async (itemId) => {

      // Only task creators can delete checklist items
      if (!isTaskCreator) {
        showDialog({
          type: 'warning',
          title: 'Permission Denied',
          message: `You can only delete checklist items from tasks you created. Task creator: ${currentTask?.CreatedByUserId}, Your ID: ${user?.userid}`
        });
        return;
      }

      try {
        await taskAPI.deleteChecklist(itemId);
        
        // Refresh checklist
        const updatedChecklist = await taskAPI.fetchChecklist(currentTask.Id);
        setChecklist(updatedChecklist.filter(item => 
          item.ItemText && item.ItemText.trim() !== ''
        ));
        
      } catch (error) {
        console.error('Error deleting checklist item:', error);
        showDialog({
          type: 'error',
          title: 'Error',
          message: 'Failed to delete checklist item'
        });
      }
    };

    const completedCount = checklist.filter(item => item.IsCompleted).length;
    const totalCount = checklist.length;
    const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

    return (
      <View style={styles.tabContent}>
        {/* Add Checklist Item Section */}
        <View style={styles.addChecklistSection}>
          <View style={styles.sectionTitle}>
            <Text style={styles.sectionTitleText}>Add Checklist Item</Text>
          </View>
          
          <View style={styles.checklistInputContainer}>
            <TextInput
              style={styles.checklistInput}
              value={newChecklistItem}
              onChangeText={setNewChecklistItem}
              multiline
              numberOfLines={2}
              textAlignVertical="top"
            />
            <Button
              title="Add"
              onPress={addChecklistItem}
              disabled={!newChecklistItem.trim()}
              variant="primary"
              style={styles.addChecklistButton}
            />
          </View>
        </View>

        {/* Progress Section */}
        {totalCount > 0 && (
          <View style={styles.progressSection}>
            <View style={styles.progressHeader}>
              <Text style={styles.progressText}>
                Progress: {completedCount} of {totalCount} completed ({progressPercent}%)
              </Text>
            </View>
            <View style={styles.progressBar}>
              <View 
                style={[
                  styles.progressFill,
                  { width: `${progressPercent}%` }
                ]} 
              />
            </View>
          </View>
        )}

        {/* Checklist Items */}
        <View style={styles.checklistSection}>
          <View style={styles.sectionTitle}>
            <Text style={styles.sectionTitleText}>
              Checklist ({totalCount})
            </Text>
          </View>
          
          {checklist.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>No checklist items yet</Text>
              <Text style={styles.emptyStateSubtext}>
                Add items to track your progress!
              </Text>
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              {checklist.map((item) => (
                <View key={item.Id} style={styles.checklistItem}>
                  <TouchableOpacity
                    style={styles.checklistItemContent}
                    onPress={() => toggleChecklistItem(item)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.checklistItemLeft}>
                      <View style={[
                        styles.checkbox,
                        item.IsCompleted && styles.checkboxChecked
                      ]}>
                        {item.IsCompleted && (
                          <Text style={styles.checkmarkText}>✓</Text>
                        )}
                      </View>
                      <Text style={[
                        styles.checklistItemText,
                        item.IsCompleted && styles.checklistItemTextCompleted
                      ]}>
                        {item.ItemText}
                      </Text>
                    </View>
                  </TouchableOpacity>
                  
                  <TouchableOpacity
                    style={styles.deleteChecklistButton}
                    onPress={() => deleteChecklistItem(item.Id)}
                  >
                    <DeleteIcon size={16} />
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    );
  };

  const renderTimeTrackingTab = () => {
    const logTime = async () => {
      const hours = parseFloat(newTimeHours);
      
      if (!hours || hours <= 0) {
        showDialog({
          type: 'error',
          title: 'Error',
          message: 'Please enter valid hours (greater than 0)'
        });
        return;
      }

      if (!newTimeDescription.trim()) {
        showDialog({
          type: 'error',
          title: 'Error',
          message: 'Please enter a description for the time entry'
        });
        return;
      }

      try {
        await taskAPI.logTime(
          currentTask.Id,
          hours,
          newTimeDescription.trim()
        );
        
        // Refresh time entries
        const updatedTimeEntries = await taskAPI.fetchTimeEntries(currentTask.Id);
        setTimeEntries(updatedTimeEntries.filter(entry => 
          entry.Hours && parseFloat(entry.Hours) > 0
        ));
        
        // Update logged hours in task
        const totalLoggedHours = updatedTimeEntries.reduce((sum, entry) => 
          sum + parseFloat(entry.Hours || 0), 0
        );
        
        const updatedTask = {
          ...currentTask,
          LoggedHours: totalLoggedHours
        };
        setCurrentTask(updatedTask);
        setEditedTask(updatedTask);
        
        // Reset form
        setNewTimeHours('');
        setNewTimeDescription('');
        
        showDialog({
          type: 'success',
          title: 'Success',
          message: 'Time logged successfully'
        });
        
      } catch (error) {
        console.error('Error logging time:', error);
        showDialog({
          type: 'error',
          title: 'Error',
          message: 'Failed to log time'
        });
      }
    };

    const deleteTimeEntry = async (entryId) => {
      try {
        await taskAPI.deleteTimeEntry(entryId);
        
        // Refresh time entries
        const updatedTimeEntries = await taskAPI.fetchTimeEntries(currentTask.Id);
        setTimeEntries(updatedTimeEntries.filter(entry => 
          entry.Hours && parseFloat(entry.Hours) > 0
        ));
        
        // Update logged hours in task
        const totalLoggedHours = updatedTimeEntries.reduce((sum, entry) => 
          sum + parseFloat(entry.Hours || 0), 0
        );
        
        const updatedTask = {
          ...currentTask,
          LoggedHours: totalLoggedHours
        };
        setCurrentTask(updatedTask);
        setEditedTask(updatedTask);
        
      } catch (error) {
        console.error('Error deleting time entry:', error);
        showDialog({
          type: 'error',
          title: 'Error',
          message: 'Failed to delete time entry'
        });
      }
    };

    const formatTimeDate = (dateString) => {
      if (!dateString) return '';
      
      const date = new Date(dateString);
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      if (date.toDateString() === today.toDateString()) {
        return 'Today';
      } else if (date.toDateString() === yesterday.toDateString()) {
        return 'Yesterday';
      } else {
        return date.toLocaleDateString();
      }
    };

    const totalLoggedHours = timeEntries.reduce((sum, entry) => 
      sum + parseFloat(entry.Hours || 0), 0
    );

    const estimatedHours = parseFloat(currentTask?.EstimatedHours || 0);
    const timeProgress = estimatedHours > 0 ? Math.round((totalLoggedHours / estimatedHours) * 100) : 0;

    return (
      <View style={styles.tabContent}>
        {/* Log Time Section */}
        <View style={styles.logTimeSection}>
          <View style={styles.sectionTitle}>
            <Text style={styles.sectionTitleText}>Log Time</Text>
          </View>
          
          <FormField
            label="Hours"
            value={newTimeHours}
            onChangeText={setNewTimeHours}
            keyboardType="numeric"
          />
          
          <FormField
            label="Description"
            value={newTimeDescription}
            onChangeText={setNewTimeDescription}
            multiline
            numberOfLines={3}
          />
          
          <Button
            title="Log Time"
            onPress={logTime}
            disabled={!newTimeHours || !newTimeDescription.trim()}
            variant="primary"
            style={styles.logTimeButton}
          />
        </View>

        {/* Time Summary */}
        <View style={styles.timeSummarySection}>
          <View style={styles.sectionTitle}>
            <Text style={styles.sectionTitleText}>Time Summary</Text>
          </View>
          
          <View style={styles.summaryGrid}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Total Logged</Text>
              <Text style={styles.summaryValue}>{totalLoggedHours.toFixed(1)}h</Text>
            </View>
            
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Estimated</Text>
              <Text style={styles.summaryValue}>{estimatedHours.toFixed(1)}h</Text>
            </View>
            
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Remaining</Text>
              <Text style={[
                styles.summaryValue,
                (estimatedHours - totalLoggedHours) < 0 ? styles.overTimeValue : null
              ]}>
                {(estimatedHours - totalLoggedHours).toFixed(1)}h
              </Text>
            </View>
          </View>
          
          {estimatedHours > 0 && (
            <View style={styles.timeProgressSection}>
              <Text style={styles.progressText}>
                Progress: {timeProgress}% of estimated time
              </Text>
              <View style={styles.progressBar}>
                <View 
                  style={[
                    styles.progressFill,
                    { 
                      width: `${Math.min(timeProgress, 100)}%`,
                      backgroundColor: timeProgress > 100 ? 
                        theme.colors.red[500] : theme.colors.blue[500]
                    }
                  ]} 
                />
              </View>
            </View>
          )}
        </View>

        {/* Time Entries List */}
        <View style={styles.timeEntriesSection}>
          <View style={styles.sectionTitle}>
            <Text style={styles.sectionTitleText}>
              Time Entries ({timeEntries.length})
            </Text>
          </View>
          
          {timeEntries.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>No time entries yet</Text>
              <Text style={styles.emptyStateSubtext}>
                Start tracking your time to monitor progress!
              </Text>
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              {timeEntries.map((entry) => {
                const isOwnEntry = entry.UserId === user.userid;
                
                return (
                  <View key={entry.Id} style={styles.timeEntryCard}>
                    <View style={styles.timeEntryHeader}>
                      <View style={styles.timeEntryLeft}>
                        <Text style={styles.timeEntryHours}>
                          {parseFloat(entry.Hours).toFixed(1)}h
                        </Text>
                        <Text style={styles.timeEntryDate}>
                          {formatTimeDate(entry.WorkDate || entry.Date)}
                        </Text>
                      </View>
                      
                      <View style={styles.timeEntryRight}>
                        <Text style={styles.timeEntryUser}>
                          {entry.UserName || entry.FullName || 'Unknown User'}
                        </Text>
                        {isOwnEntry && (
                          <TouchableOpacity
                            style={styles.deleteTimeButton}
                            onPress={() => deleteTimeEntry(entry.Id)}
                          >
                            <DeleteIcon size={16} />
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                    
                    <Text style={styles.timeEntryDescription}>
                      {entry.Description}
                    </Text>
                  </View>
                );
              })}
            </ScrollView>
          )}
        </View>
      </View>
    );
  };

  return (
    <BottomSheetModal
      visible={visible}
      onClose={onClose}
      title={currentTask?.Title || 'Task'}
      rightElement={
        canEdit && !editMode ? (
          <View style={styles.headerButtons}>
            <TouchableOpacity
              style={styles.deleteButton}
              onPress={deleteTask}
            >
              <DeleteIcon size={16} color={theme.colors.white} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.editButton}
              onPress={() => setEditMode(true)}
            >
              <EditIcon size={16} color={theme.colors.white} />
            </TouchableOpacity>
          </View>
        ) : null
      }
    >
      <View style={styles.container}>
        {/* Tab Navigation */}
        <View style={styles.tabsContainer}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabsContent}
          >
            {tabs.map(renderTabButton)}
          </ScrollView>
        </View>

        {/* Tab Content */}
        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {renderTabContent()}
        </ScrollView>
      </View>

      <Dialog
        visible={dialogVisible}
        onClose={() => setDialogVisible(false)}
        type={dialogConfig.type || 'info'}
        title={dialogConfig.title}
        message={dialogConfig.message}
        confirmText={dialogConfig.confirmText}
        cancelText={dialogConfig.cancelText}
        showCancel={dialogConfig.showCancel}
        onConfirm={dialogConfig.onConfirm}
        onCancel={dialogConfig.onCancel}
      />
    </BottomSheetModal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 0,
  },
  tabsContainer: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.gray[200],
    backgroundColor: theme.colors.white,
    marginBottom: 8,
    marginTop: -16,
  },
  tabsContent: {
    paddingHorizontal: 2,
    paddingTop: 0,
    paddingBottom: 2,
  },
  tabButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginRight: 16,
    position: 'relative',
  },
  tabLabel: {
    fontSize: 14,
    fontWeight: theme.typography.fontWeights.semibold,
    color: theme.colors.gray[600],
  },
  activeTabLabel: {
    color: theme.colors.primary.brand,
    fontWeight: theme.typography.fontWeights.semibold,
  },
  tabUnderline: {
    position: 'absolute',
    bottom: 0,
    left: 12,
    right: 12,
    height: 2,
    backgroundColor: theme.colors.primary.brand,
  },
  content: {
    flex: 1,
    paddingHorizontal: 2,
  },
  tabContent: {
    paddingVertical: 2,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: theme.colors.gray[600],
    fontWeight: theme.typography.fontWeights.normal,
  },
  placeholderText: {
    fontSize: 16,
    color: theme.colors.gray[500],
    textAlign: 'center',
    fontStyle: 'italic',
  },
  
  // Header edit button
  editButton: {
    width: 32,
    height: 32,
    backgroundColor: theme.colors.primary.brand,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  
  // Overview tab styles
  section: {
    marginBottom: 2,
  },
  sectionTitle: {
    marginBottom: 12,
    alignSelf: 'flex-start',
    borderRadius: 12,
    padding: 2,
    backgroundColor: theme.colors.white,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 1,
  },
  sectionTitleText: {
    fontSize: 14,
    fontWeight: theme.typography.fontWeights.semibold,
    color: theme.colors.white,
    backgroundColor: theme.colors.primary.brand,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.gray[100],
  },
  infoLabel: {
    fontSize: 14,
    fontWeight: theme.typography.fontWeights.normal,
    color: theme.colors.gray[600],
    flex: 1,
  },
  infoValue: {
    fontSize: 14,
    color: theme.colors.gray[800],
    fontWeight: theme.typography.fontWeights.normal,
    flex: 2,
    textAlign: 'right',
  },
  editActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
    gap: 12,
  },
  cancelButton: {
    flex: 1,
  },
  saveButton: {
    flex: 1,
  },
  
  // Comments tab styles
  addCommentSection: {
    marginBottom: 2,
  },
  commentInputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
  },
  commentInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.colors.gray[300],
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: theme.colors.gray[800],
    backgroundColor: theme.colors.white,
    minHeight: 80,
  },
  addCommentButton: {
    paddingHorizontal: 20,
  },
  commentsSection: {
    flex: 1,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyStateText: {
    fontSize: 16,
    fontWeight: theme.typography.fontWeights.normal,
    color: theme.colors.gray[600],
    marginBottom: 8,
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: theme.colors.gray[500],
  },
  commentCard: {
    backgroundColor: theme.colors.white,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: theme.colors.gray[200],
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  commentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  commentAuthor: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  commentAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.colors.primary.brand,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  commentAvatarText: {
    fontSize: 14,
    fontWeight: theme.typography.fontWeights.bold,
    color: theme.colors.white,
  },
  commentInfo: {
    flex: 1,
  },
  commentUserName: {
    fontSize: 14,
    fontWeight: theme.typography.fontWeights.semibold,
    color: theme.colors.gray[800],
  },
  commentDate: {
    fontSize: 12,
    color: theme.colors.gray[500],
    marginTop: 2,
  },
  deleteCommentButton: {
    padding: 8,
  },
  commentText: {
    fontSize: 14,
    color: theme.colors.gray[700],
    lineHeight: 20,
  },
  
  // Checklist tab styles
  addChecklistSection: {
    marginBottom: 2,
  },
  checklistInputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
  },
  checklistInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.colors.gray[300],
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: theme.colors.gray[800],
    backgroundColor: theme.colors.white,
    minHeight: 60,
  },
  addChecklistButton: {
    paddingHorizontal: 20,
  },
  progressSection: {
    marginBottom: 2,
    padding: 2,
    backgroundColor: '#FDF2F8', // Light pink background
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FCE7F3', // Pink border
  },
  progressHeader: {
    marginBottom: 12,
  },
  progressText: {
    fontSize: 14,
    fontWeight: theme.typography.fontWeights.normal,
    color: '#BE185D', // Dark pink text
  },
  progressBar: {
    height: 8,
    backgroundColor: '#FCE7F3', // Light pink track
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: theme.colors.primary.secondary, // Use the pink secondary from theme
    borderRadius: 4,
  },
  checklistSection: {
    flex: 1,
  },
  checklistItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.white,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: theme.colors.gray[200],
  },
  checklistItemContent: {
    flex: 1,
  },
  checklistItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: theme.colors.gray[300],
    marginRight: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxChecked: {
    backgroundColor: theme.colors.green[500],
    borderColor: theme.colors.green[500],
  },
  checkmarkText: {
    color: theme.colors.white,
    fontSize: 12,
    fontWeight: theme.typography.fontWeights.bold,
  },
  checklistItemText: {
    fontSize: 14,
    color: theme.colors.gray[800],
    flex: 1,
  },
  checklistItemTextCompleted: {
    textDecorationLine: 'line-through',
    color: theme.colors.gray[500],
  },
  deleteChecklistButton: {
    padding: 8,
  },
  
  // Time tracking tab styles
  logTimeSection: {
    marginBottom: 2,
  },
  logTimeSectionTitle: {
    marginBottom: 2,
  },
  timeInputRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 2,
    alignItems: 'flex-end',
  },
  hoursInputContainer: {
    flex: 1,
  },
  dateInputContainer: {
    flex: 2,
  },
  hoursInput: {
    marginBottom: 0,
  },
  dateInput: {
    marginBottom: 0,
    marginTop: 18, // Align with FormField's floating label space
  },
  logTimeButton: {
    marginTop: 2,
  },
  timeSummarySection: {
    marginBottom: 2,
    padding: 2,
    backgroundColor: theme.colors.blue[50],
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.blue[100],
  },
  summaryGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  summaryItem: {
    alignItems: 'center',
    flex: 1,
  },
  summaryLabel: {
    fontSize: 12,
    color: theme.colors.gray[600],
    fontWeight: theme.typography.fontWeights.normal,
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 18,
    fontWeight: theme.typography.fontWeights.bold,
    color: theme.colors.blue[700],
  },
  overTimeValue: {
    color: theme.colors.red[600],
  },
  timeProgressSection: {
    marginTop: 12,
  },
  timeEntriesSection: {
    flex: 1,
  },
  timeEntryCard: {
    backgroundColor: theme.colors.white,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: theme.colors.gray[200],
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  timeEntryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  timeEntryLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  timeEntryHours: {
    fontSize: 18,
    fontWeight: theme.typography.fontWeights.bold,
    color: theme.colors.blue[600],
    marginRight: 12,
    minWidth: 50,
  },
  timeEntryDate: {
    fontSize: 14,
    color: theme.colors.gray[600],
    fontWeight: theme.typography.fontWeights.normal,
  },
  timeEntryRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timeEntryUser: {
    fontSize: 12,
    color: theme.colors.gray[500],
    marginRight: 8,
  },
  deleteTimeButton: {
    padding: 8,
  },
  timeEntryDescription: {
    fontSize: 14,
    color: theme.colors.gray[700],
    lineHeight: 20,
  },

  // Header buttons
  headerButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  editButton: {
    backgroundColor: theme.colors.primary.brand,
    borderRadius: 8,
    padding: 8,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  deleteButton: {
    backgroundColor: theme.colors.status.error,
    borderRadius: 8,
    padding: 8,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
});

export default TaskModal;