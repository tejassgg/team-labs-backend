const express = require('express');
const router = express.Router();
const Subtask = require('../models/Subtask');
const TaskDetails = require('../models/TaskDetails');
const User = require('../models/User');
const { logActivity } = require('../services/activityService');
const { emitToTask } = require('../socket');
const { protect } = require('../middleware/auth');

// GET /api/subtasks/:taskId - Get all subtasks for a task
router.get('/:taskId', protect, async (req, res) => {
  try {
    const { taskId } = req.params;
    
    // Verify task exists
    const task = await TaskDetails.findOne({ TaskID: taskId, IsActive: true });
    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }

    const subtasks = await Subtask.find({ 
      TaskID_FK: taskId, 
      IsActive: true 
    }).sort({ CreatedDate: 1 });

    // Populate user details for CreatedBy and CompletedBy
    const populatedSubtasks = await Promise.all(
      subtasks.map(async (subtask) => {
        const subtaskObj = subtask.toObject();
        
        if (subtask.CreatedBy) {
          const createdByUser = await User.findById(subtask.CreatedBy).select('firstName lastName username email');
          if (createdByUser) {
            subtaskObj.CreatedByDetails = {
              _id: createdByUser._id,
              fullName: `${createdByUser.firstName} ${createdByUser.lastName}`,
            };
          }
        }
        
        if (subtask.CompletedBy) {
          const completedByUser = await User.findById(subtask.CompletedBy).select('firstName lastName username email');
          if (completedByUser) {
            subtaskObj.CompletedByDetails = {
              _id: completedByUser._id,
              fullName: `${completedByUser.firstName} ${completedByUser.lastName}`,
            };
          }
        }
        
        return subtaskObj;
      })
    );

    res.json({ subtasks: populatedSubtasks });
  } catch (error) {
    console.error('Error fetching subtasks:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/subtasks - Create a new subtask
router.post('/', protect, async (req, res) => {
  try {
    const { TaskID_FK, Name } = req.body;
    const CreatedBy = req.user.id;

    // Validate required fields
    if (!TaskID_FK || !Name) {
      return res.status(400).json({ message: 'Task ID and Name are required' });
    }

    // Verify task exists
    const task = await TaskDetails.findOne({ TaskID: TaskID_FK, IsActive: true });
    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }

    const newSubtask = new Subtask({
      TaskID_FK,
      Name,
      CreatedBy
    });

    const savedSubtask = await newSubtask.save();
    const subtaskObj = savedSubtask.toObject();

    // Populate CreatedBy details
    const createdByUser = await User.findById(CreatedBy).select('firstName lastName username email');
    if (createdByUser) {
      subtaskObj.CreatedByDetails = {
        _id: createdByUser._id,
        fullName: `${createdByUser.firstName} ${createdByUser.lastName}`,
      };
    }

    // Log activity
    await logActivity(
      CreatedBy,
      'subtask_create',
      'success',
      `Created subtask "${Name}" for task "${task.Name}"`,
      req,
      {
        taskId: TaskID_FK,
        taskName: task.Name,
        subtaskId: savedSubtask.SubtaskID,
        subtaskName: Name,
        projectId: task.ProjectID_FK
      }
    );

    // Emit socket event
    emitToTask(TaskID_FK, 'task.subtask.created', {
      subtask: subtaskObj,
      taskId: TaskID_FK
    });

    res.status(201).json({ subtask: subtaskObj });
  } catch (error) {
    console.error('Error creating subtask:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// PUT /api/subtasks/:subtaskId - Update a subtask
router.put('/:subtaskId', protect, async (req, res) => {
  try {
    const { subtaskId } = req.params;
    const { Name } = req.body;
    const ModifiedBy = req.user.id;

    const subtask = await Subtask.findOne({ SubtaskID: subtaskId, IsActive: true });
    if (!subtask) {
      return res.status(404).json({ message: 'Subtask not found' });
    }

    // Update fields
    if (Name !== undefined) subtask.Name = Name;
    
    subtask.ModifiedDate = new Date();
    subtask.ModifiedBy = ModifiedBy;

    const updatedSubtask = await subtask.save();
    const subtaskObj = updatedSubtask.toObject();

    // Populate user details
    const createdByUser = await User.findById(subtask.CreatedBy).select('firstName lastName username email');
    if (createdByUser) {
      subtaskObj.CreatedByDetails = {
        _id: createdByUser._id,
        fullName: `${createdByUser.firstName} ${createdByUser.lastName}`,
      };
    }

    if (subtask.CompletedBy) {
      const completedByUser = await User.findById(subtask.CompletedBy).select('firstName lastName username email');
      if (completedByUser) {
        subtaskObj.CompletedByDetails = {
          _id: completedByUser._id,
          fullName: `${completedByUser.firstName} ${completedByUser.lastName}`,
        };
      }
    }

    // Log activity
    await logActivity(
      ModifiedBy,
      'subtask_update',
      'success',
      `Updated subtask "${subtask.Name}"`,
      req,
      {
        taskId: subtask.TaskID_FK,
        subtaskId: subtaskId,
        subtaskName: subtask.Name
      }
    );

    // Emit socket event
    emitToTask(subtask.TaskID_FK, 'task.subtask.updated', {
      subtask: subtaskObj,
      taskId: subtask.TaskID_FK
    });

    res.json({ subtask: subtaskObj });
  } catch (error) {
    console.error('Error updating subtask:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// PATCH /api/subtasks/:subtaskId/toggle - Toggle subtask completion status
router.patch('/:subtaskId/toggle', protect, async (req, res) => {
  try {
    const { subtaskId } = req.params;
    const userId = req.user.id;

    const subtask = await Subtask.findOne({ SubtaskID: subtaskId, IsActive: true });
    if (!subtask) {
      return res.status(404).json({ message: 'Subtask not found' });
    }

    // Toggle completion status
    subtask.IsCompleted = !subtask.IsCompleted;
    
    if (subtask.IsCompleted) {
      subtask.CompletedBy = userId;
      subtask.CompletedDate = new Date();
    } else {
      subtask.CompletedBy = null;
      subtask.CompletedDate = null;
    }

    subtask.ModifiedDate = new Date();
    subtask.ModifiedBy = userId;

    const updatedSubtask = await subtask.save();
    const subtaskObj = updatedSubtask.toObject();

    // Populate user details
    const createdByUser = await User.findById(subtask.CreatedBy).select('firstName lastName username email');
    if (createdByUser) {
      subtaskObj.CreatedByDetails = {
        _id: createdByUser._id,
        fullName: `${createdByUser.firstName} ${createdByUser.lastName}`,
      };
    }

    if (subtask.CompletedBy) {
      const completedByUser = await User.findById(subtask.CompletedBy).select('firstName lastName username email');
      if (completedByUser) {
        subtaskObj.CompletedByDetails = {
          _id: completedByUser._id,
          fullName: `${completedByUser.firstName} ${completedByUser.lastName}`,
        };
      }
    }

    // Log activity
    const action = subtask.IsCompleted ? 'Completed subtask' : 'Uncompleted subtask';
    await logActivity(
      userId,
      subtask.IsCompleted ? 'subtask_complete' : 'subtask_uncomplete',
      'success',
      `${action} "${subtask.Name}"`,
      req,
      {
        taskId: subtask.TaskID_FK,
        subtaskId: subtaskId,
        subtaskName: subtask.Name
      }
    );

    // Emit socket event (use updated for toggle)
    emitToTask(subtask.TaskID_FK, 'task.subtask.updated', {
      subtask: subtaskObj,
      taskId: subtask.TaskID_FK
    });

    res.json({ subtask: subtaskObj });
  } catch (error) {
    console.error('Error toggling subtask:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// DELETE /api/subtasks/:subtaskId - Delete a subtask
router.delete('/:subtaskId', protect, async (req, res) => {
  try {
    const { subtaskId } = req.params;
    const userId = req.user.id;

    const subtask = await Subtask.findOne({ SubtaskID: subtaskId, IsActive: true });
    if (!subtask) {
      return res.status(404).json({ message: 'Subtask not found' });
    }

    // Soft delete
    subtask.IsActive = false;
    subtask.ModifiedDate = new Date();
    subtask.ModifiedBy = userId;

    await subtask.save();

    // Log activity
    await logActivity(
      userId,
      'subtask_delete',
      'success',
      `Deleted subtask "${subtask.Name}"`,
      req,
      {
        taskId: subtask.TaskID_FK,
        subtaskId: subtaskId,
        subtaskName: subtask.Name
      }
    );

    // Emit socket event
    emitToTask(subtask.TaskID_FK, 'task.subtask.deleted', {
      subtaskId,
      taskId: subtask.TaskID_FK
    });

    res.json({ message: 'Subtask deleted successfully' });
  } catch (error) {
    console.error('Error deleting subtask:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;
