const express = require('express');
const router = express.Router();
const Comment = require('../models/Comment');
const TaskDetails = require('../models/TaskDetails');
const User = require('../models/User');
const Project = require('../models/Project');
const { logActivity } = require('../services/activityService');
const { sendCommentMentionEmail } = require('../services/emailService');
const { emitToTask, emitToProject } = require('../socket');

// Get all comments for a task
router.get('/tasks/:taskId/comments', async (req, res) => {
  try {
    const { taskId } = req.params;
    const comments = await Comment.find({ TaskID: taskId }).sort({ CreatedAt: 1 });
    res.json(comments);
  } catch (err) {
    console.error('Error fetching comments:', err);
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

// Add a new comment to a task
router.post('/tasks/:taskId/comments', async (req, res) => {
  try {
    const { taskId } = req.params;
    const { Author, Content } = req.body;

    // Validate input
    if (!Author || !Content) {
      return res.status(400).json({ error: 'Author and Content are required' });
    }

    if (Content.trim().length === 0) {
      return res.status(400).json({ error: 'Comment content cannot be empty' });
    }

    // Check if task exists
    const task = await TaskDetails.findOne({ TaskID: taskId });
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Create the comment
    const comment = new Comment({ 
      TaskID: taskId, 
      Author, 
      Content: Content.trim() 
    });
    await comment.save();

    // Parse mentions from comment content
    const parseMentions = (content) => {
      const mentionRegex = /@([A-Za-z_]+)/g;
      const mentions = [];
      let match;
      while ((match = mentionRegex.exec(content)) !== null) {
        mentions.push(match[1].replace(/_/g, ' '));
      }
      return mentions;
    };

    // Send email notifications to mentioned users
    const mentionedNames = parseMentions(Content);
    if (mentionedNames.length > 0) {
      try {
        // Get project info for email
        const project = await Project.findOne({ ProjectID: task.ProjectID_FK });
        
        // Find mentioned users by their full name
        for (const mentionedName of mentionedNames) {
          const mentionedUser = await User.findOne({
            $or: [
              { firstName: { $regex: new RegExp(`^${mentionedName.split(' ')[0]}`, 'i') } },
              { lastName: { $regex: new RegExp(`^${mentionedName.split(' ')[1] || ''}`, 'i') } },
              { 
                $expr: {
                  $regexMatch: {
                    input: { $concat: ['$firstName', ' ', '$lastName'] },
                    regex: new RegExp(mentionedName, 'i')
                  }
                }
              }
            ]
          });

          if (mentionedUser && mentionedUser.email) {
            // Send email notification
            await sendCommentMentionEmail(
              mentionedUser.email,
              mentionedUser.fullName || (mentionedUser.firstName + ' ' + mentionedUser.lastName), // mentionTo
              Content, // or update.Content for update route
              task.Name,
              taskId, // or comment.TaskID for update route
              project,
              task.Type,
              task.Status,
              task.Priority,
              Author // or comment.Author for update route
            );
          }
        }
      } catch (emailError) {
        console.error('Error sending mention emails:', emailError);
        // Don't fail the request if email fails
      }
    }

    // Log the activity
    await logActivity(
      task.CreatedBy,
      'comment_added',
      'success',
      `${Author} added a comment to task "${task.Name}"`,
      req,
      {
        taskId: taskId,
        taskName: task.Name,
        commentId: comment.CommentID,
        author: Author,
        projectId: task.ProjectID_FK
      }
    );

    try {
      emitToTask(taskId, 'task.comment.created', {
        event: 'task.comment.created',
        version: 1,
        data: { taskId, comment },
        meta: { emittedAt: new Date().toISOString() }
      });
      emitToProject(task.ProjectID_FK, 'task.comment.created', {
        event: 'task.comment.created',
        version: 1,
        data: { taskId, comment },
        meta: { emittedAt: new Date().toISOString() }
      });
    } catch (e) {}
    res.status(201).json(comment);
  } catch (err) {
    console.error('Error adding comment:', err);
    res.status(500).json({ error: 'Failed to add comment' });
  }
});

// Update a comment
router.patch('/comments/:commentId', async (req, res) => {
  try {
    const { commentId } = req.params;
    const update = req.body;

    // Validate input
    if (update.Content && update.Content.trim().length === 0) {
      return res.status(400).json({ error: 'Comment content cannot be empty' });
    }

    // Find the comment
    const comment = await Comment.findOne({ CommentID: commentId });
    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    // Get task details for activity logging
    const task = await TaskDetails.findOne({ TaskID: comment.TaskID });
    if (!task) {
      return res.status(404).json({ error: 'Associated task not found' });
    }

    // Parse mentions from updated comment content
    const parseMentions = (content) => {
      const mentionRegex = /@([A-Za-z_]+)/g;
      const mentions = [];
      let match;
      while ((match = mentionRegex.exec(content)) !== null) {
        mentions.push(match[1].replace(/_/g, ' '));
      }
      return mentions;
    };

    // Send email notifications to newly mentioned users (only if content changed)
    if (update.Content && update.Content !== comment.Content) {
      const oldMentions = parseMentions(comment.Content);
      const newMentions = parseMentions(update.Content);
      
      // Find newly mentioned users (not mentioned in the original comment)
      const newlyMentioned = newMentions.filter(name => !oldMentions.includes(name));
      
      if (newlyMentioned.length > 0) {
        try {
          // Get project info for email
          const project = await Project.findOne({ ProjectID: task.ProjectID_FK });
          
          // Find mentioned users by their full name
          for (const mentionedName of newlyMentioned) {
            const mentionedUser = await User.findOne({
              $or: [
                { firstName: { $regex: new RegExp(`^${mentionedName.split(' ')[0]}`, 'i') } },
                { lastName: { $regex: new RegExp(`^${mentionedName.split(' ')[1] || ''}`, 'i') } },
                { 
                  $expr: {
                    $regexMatch: {
                      input: { $concat: ['$firstName', ' ', '$lastName'] },
                      regex: new RegExp(mentionedName, 'i')
                    }
                  }
                }
              ]
            });

            if (mentionedUser && mentionedUser.email) {
              // Send email notification
              await sendCommentMentionEmail(
                mentionedUser.email,
                mentionedUser.fullName || (mentionedUser.firstName + ' ' + mentionedUser.lastName), // mentionTo
                update.Content, // or update.Content for update route
                task.Name,
                comment.TaskID, // or comment.TaskID for update route
                project,
                task.Type,
                task.Status,
                task.Priority,
                comment.Author // or comment.Author for update route
              );
            }
          }
        } catch (emailError) {
          console.error('Error sending mention emails for updated comment:', emailError);
          // Don't fail the request if email fails
        }
      }
    }

    // Update the comment
    const updatedComment = await Comment.findOneAndUpdate(
      { CommentID: commentId }, 
      { ...update, Content: update.Content?.trim() }, 
      { new: true }
    );

    // Log the activity
    await logActivity(
      task.CreatedBy,
      'comment_updated',
      'success',
      `${comment.Author} updated a comment on task "${task.Name}"`,
      req,
      {
        taskId: comment.TaskID,
        taskName: task.Name,
        commentId: commentId,
        author: comment.Author,
        projectId: task.ProjectID_FK
      }
    );

    try {
      emitToTask(comment.TaskID, 'task.comment.updated', {
        event: 'task.comment.updated',
        version: 1,
        data: { taskId: comment.TaskID, comment: updatedComment },
        meta: { emittedAt: new Date().toISOString() }
      });
    } catch (e) {}
    res.json(updatedComment);
  } catch (err) {
    console.error('Error updating comment:', err);
    res.status(500).json({ error: 'Failed to update comment' });
  }
});

// Delete a comment
router.delete('/comments/:commentId', async (req, res) => {
  try {
    const { commentId } = req.params;

    // Find the comment
    const comment = await Comment.findOne({ CommentID: commentId });
    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    // Get task details for activity logging
    const task = await TaskDetails.findOne({ TaskID: comment.TaskID });
    if (!task) {
      return res.status(404).json({ error: 'Associated task not found' });
    }

    // Delete the comment
    const result = await Comment.findOneAndDelete({ CommentID: commentId });

    // Log the activity
    await logActivity(
      task.CreatedBy,
      'comment_deleted',
      'success',
      `${comment.Author} deleted a comment from task "${task.Name}"`,
      req,
      {
        taskId: comment.TaskID,
        taskName: task.Name,
        commentId: commentId,
        author: comment.Author,
        projectId: task.ProjectID_FK
      }
    );

    try {
      emitToTask(comment.TaskID, 'task.comment.deleted', {
        event: 'task.comment.deleted',
        version: 1,
        data: { taskId: comment.TaskID, commentId },
        meta: { emittedAt: new Date().toISOString() }
      });
    } catch (e) {}
    res.json({ message: 'Comment deleted successfully' });
  } catch (err) {
    console.error('Error deleting comment:', err);
    res.status(500).json({ error: 'Failed to delete comment' });
  }
});

module.exports = router; 