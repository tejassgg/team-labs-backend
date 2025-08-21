const UserActivity = require('../models/UserActivity');

const logActivity = async (userId, type, status, details = '', req = null, metadata = {}, loginMethod = null) => {
  try {
    const activityData = {
      type,
      status,
      details,
      metadata
    };

    // Only add user ID if it exists
    if (userId) {
      activityData.user = userId;
    }

    // Add login method if provided
    if (loginMethod) {
      activityData.loginMethod = loginMethod;
    }

    // Add request information if available
    if (req) {
      activityData.ipAddress = req.ip || req.connection.remoteAddress;
      activityData.userAgent = req.headers['user-agent'];
    }

    const activity = await UserActivity.create(activityData);
    return activity;
  } catch (error) {
    console.error('Error logging user activity:', error);
    // Log the error activity itself
    try {
      await UserActivity.create({
        type: 'error',
        status: 'error',
        details: `Failed to log activity: ${error.message}`,
        metadata: {
          originalType: type,
          originalStatus: status,
          originalDetails: details,
          error: error.message
        },
        user: userId,
        ipAddress: req?.ip || req?.connection?.remoteAddress,
        userAgent: req?.headers?.['user-agent']
      });
    } catch (logError) {
      console.error('Failed to log error activity:', logError);
    }
    throw error;
  }
};

const getUserActivities = async (userId, page = 1, limit = 10) => {
  try {
    const skip = (page - 1) * limit;
    
    // Get total count for pagination
    const total = await UserActivity.countDocuments({ user: userId });
    
    // Get paginated activities
    const activities = await UserActivity.find({ user: userId })
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit);

    return {
      activities,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    };
  } catch (error) {
    console.error('Error fetching user activities:', error);
    throw error;
  }
};

const getProjectActivities = async (projectId) => {
  try {
    // Find all activities where metadata.projectId matches
    let activities = await UserActivity.find({ 'metadata.projectId': projectId })
      .populate('user', 'firstName lastName email profileImage')
      .sort({ timestamp: -1 })
      .lean();

    // For comment_added activities, fetch the comment details
    const Comment = require('../models/Comment');
    await Promise.all(activities.map(async (activity) => {
      if (activity.type === 'comment_added' && activity.metadata && activity.metadata.commentId) {
        const comment = await Comment.findOne({ CommentID: activity.metadata.commentId });
        if (comment) {
          activity.metadata.comment = comment.Content;
        }
      }
    }));

    return activities;
  } catch (error) {
    console.error('Error fetching project activities:', error);
    throw error;
  }
};

module.exports = {
  logActivity,
  getUserActivities,
  getProjectActivities
}; 