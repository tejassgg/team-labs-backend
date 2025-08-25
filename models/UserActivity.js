const mongoose = require('mongoose');

const userActivitySchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  type: {
    type: String,
    required: true,
    enum: [
      // Authentication activities
      'login', 'logout', 'login_failed', 'profile_update', 'password_change', 'email_verification',
      // Team activities
      'team_create', 'team_update', 'team_delete', 'team_join', 'team_leave', 'team_status_toggle',
      // Project activities
      'project_create', 'project_update', 'project_delete', 'project_settings_update',
      // Task activities
      'task_create', 'task_update', 'task_delete', 'task_complete', 'task_assign',
      // User Story activities
      'user_story_create', 'user_story_update', 'user_story_delete',
      // Comment activities
      'comment_added', 'comment_updated', 'comment_deleted',
      // Error activities
      'error',
      // Chatbot activities
      'chatbot_interaction',
      // Team Member activities
      'team_members_remove','team_projects_remove', 'project_team_add',
      // Repository activities
      'repository_linked', 'repository_unlinked',
      // Team Join Request activities
      'team_join_request',
      // Attachment activities
      'attachment_added', 'attachment_deleted',
      // Subtask activities
      'subtask_create', 'subtask_update', 'subtask_delete', 'subtask_complete', 'subtask_assign', 'subtask_reorder', 'subtask_uncomplete'
    ]
  },
  status: {
    type: String,
    required: true,
    enum: ['success', 'error', 'warning', 'info']
  },
  loginMethod: {
    type: String,
    enum: ['email', 'google', null],
    default: null
  },
  details: {
    type: String,
    default: ''
  },
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {}
  },
  ipAddress: {
    type: String
  },
  userAgent: {
    type: String
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

// Index for faster queries
userActivitySchema.index({ user: 1, timestamp: -1 });
userActivitySchema.index({ type: 1, loginMethod: 1 });
userActivitySchema.index({ 'metadata.teamId': 1 });
userActivitySchema.index({ 'metadata.projectId': 1 });
userActivitySchema.index({ 'metadata.taskId': 1 });

const UserActivity = mongoose.model('UserActivity', userActivitySchema);

module.exports = UserActivity; 