const express = require('express');
const router = express.Router();
const Attachment = require('../models/Attachment');
const TaskDetails = require('../models/TaskDetails');
const User = require('../models/User');
const { emitToTask, emitToProject } = require('../socket');
const fs = require('fs');
const path = require('path');

// Get all attachments for a project
// GET /api/attachments/project/:projectId
router.get('/project/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    
    if (!projectId) {
      return res.status(400).json({ error: 'Project ID is required' });
    }

    // Get all tasks for the project
    const tasks = await TaskDetails.find({ ProjectID_FK: projectId, IsActive: true });
    const taskIds = tasks.map(task => task.TaskID);

    // Get all attachments for these tasks AND project-level attachments
    const taskAttachments = await Attachment.find({ TaskID: { $in: taskIds } });
    const projectAttachments = await Attachment.find({ ProjectID: projectId });
    
    // Combine and sort by upload date
    const allAttachments = [...taskAttachments, ...projectAttachments].sort((a, b) => 
      new Date(b.UploadedAt) - new Date(a.UploadedAt)
    );

    // Fetch uploader details for each attachment
    const attachmentsWithUserDetails = await Promise.all(allAttachments.map(async (attachment) => {
      const uploader = await User.findById(attachment.UploadedBy);
      const task = attachment.TaskID ? tasks.find(t => t.TaskID === attachment.TaskID) : null;
      
      return {
        ...attachment.toObject(),
        uploaderDetails: uploader ? {
          _id: uploader._id,
          fullName: `${uploader.firstName} ${uploader.lastName}`,
          email: uploader.email
        } : null,
        taskDetails: task ? {
          TaskID: task.TaskID,
          Name: task.Name,
          Type: task.Type
        } : null,
        isProjectAttachment: !attachment.TaskID && attachment.ProjectID
      };
    }));

    res.json(attachmentsWithUserDetails);
  } catch (err) {
    console.error('Error fetching project attachments:', err);
    res.status(500).json({ error: 'Failed to fetch project attachments' });
  }
});

// Add project-level attachment by metadata (client saves file locally and passes URL)
// POST /api/attachments/project/:projectId/attachments
router.post('/project/:projectId/attachments', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { Filename, FileURL, UploadedBy, FileSize } = req.body;
    if (!projectId || !Filename || !FileURL || !UploadedBy || !FileSize) {
      return res.status(400).json({ error: 'Project ID, Filename, FileURL, and UploadedBy are required' });
    }

    const attachment = new Attachment({
      ProjectID: projectId,
      TaskID: null,
      Filename,
      FileURL,
      UploadedBy,
      FileSize,
      UploadedAt: new Date()
    });
    await attachment.save();
    try { emitToProject(projectId, 'project.attachment.added', { event: 'project.attachment.added', version: 1, data: { projectId, attachment }, meta: { emittedAt: new Date().toISOString() } }); } catch (e) {}
    return res.status(201).json(attachment);
  } catch (err) {
    console.error('Error adding project attachment:', err);
    res.status(500).json({ error: 'Failed to add project attachment' });
  }
});

// Get all attachments for a task
// GET /api/attachments/tasks/:taskId/attachments
router.get('/tasks/:taskId/attachments', async (req, res) => {
  try {
    const { taskId } = req.params;
    
    if (!taskId) {
      return res.status(400).json({ error: 'Task ID is required' });
    }

    const attachments = await Attachment.find({ TaskID: taskId }).sort({ UploadedAt: -1 });
    res.json(attachments);
  } catch (err) {
    console.error('Error fetching attachments:', err);
    res.status(500).json({ error: 'Failed to fetch attachments' });
  }
});

// Add a new attachment (for backward compatibility)
// POST /api/attachments/tasks/:taskId/attachments
router.post('/tasks/:taskId/attachments', async (req, res) => {
  try {
    const { taskId } = req.params;
    const { Filename, FileURL, UploadedBy, FileSize } = req.body;
    
    if (!taskId || !Filename || !FileURL || !UploadedBy || !FileSize) {
      return res.status(400).json({ error: 'Task ID, Filename, FileURL, and UploadedBy are required' });
    }

    const attachment = new Attachment({ 
      TaskID: taskId, 
      Filename, 
      FileURL, 
      UploadedBy,
      FileSize,
      UploadedAt: new Date()
    });
    
    await attachment.save();
    try { emitToTask(taskId, 'task.attachment.added', { event: 'task.attachment.added', version: 1, data: { taskId, attachment }, meta: { emittedAt: new Date().toISOString() } }); } catch (e) {}
    res.status(201).json(attachment);
  } catch (err) {
    console.error('Error adding attachment:', err);
    res.status(500).json({ error: 'Failed to add attachment' });
  }
});



// Delete an attachment
// DELETE /api/attachments/:attachmentId
router.delete('/:attachmentId', async (req, res) => {
  try {
    const { attachmentId } = req.params;
    
    if (!attachmentId) {
      return res.status(400).json({ error: 'Attachment ID is required' });
    }

    // Find the attachment first to get the file path
    const attachment = await Attachment.findOne({ AttachmentID: attachmentId });
    
    if (!attachment) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    // Ask client Next.js API to remove the physical file (stored under client/public)
    if (attachment.FileURL) {
      try {
        const base = process.env.FRONTEND_URL;
        fetch(`${base}/api/local-delete?path=${encodeURIComponent(attachment.FileURL)}`, { method: 'DELETE' }).catch(() => {});
      } catch (_) {}
    }

    // Delete from database
    await Attachment.findOneAndDelete({ AttachmentID: attachmentId });

    // Broadcast real-time updates to task or project scopes
    if (attachment.TaskID) {
      try { emitToTask(attachment.TaskID, 'task.attachment.removed', { event: 'task.attachment.removed', version: 1, data: { taskId: attachment.TaskID, attachmentId }, meta: { emittedAt: new Date().toISOString() } }); } catch (e) {}
    }
    if (!attachment.TaskID && attachment.ProjectID) {
      try { emitToProject(attachment.ProjectID, 'project.attachment.removed', { event: 'project.attachment.removed', version: 1, data: { projectId: attachment.ProjectID, attachmentId }, meta: { emittedAt: new Date().toISOString() } }); } catch (e) {}
    }
    
    res.json({ 
      success: true,
      message: 'Attachment deleted successfully' 
    });
  } catch (err) {
    console.error('Error deleting attachment:', err);
    res.status(500).json({ error: 'Failed to delete attachment' });
  }
});

// Get a single attachment by ID
// GET /api/attachments/:attachmentId
router.get('/:attachmentId', async (req, res) => {
  try {
    const { attachmentId } = req.params;
    
    if (!attachmentId) {
      return res.status(400).json({ error: 'Attachment ID is required' });
    }

    const attachment = await Attachment.findOne({ AttachmentID: attachmentId });
    
    if (!attachment) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    res.json(attachment);
  } catch (err) {
    console.error('Error fetching attachment:', err);
    res.status(500).json({ error: 'Failed to fetch attachment' });
  }
});

// Update an attachment
// PATCH /api/attachments/:attachmentId
router.patch('/:attachmentId', async (req, res) => {
  try {
    const { attachmentId } = req.params;
    const updateData = req.body;
    
    if (!attachmentId) {
      return res.status(400).json({ error: 'Attachment ID is required' });
    }

    const attachment = await Attachment.findOneAndUpdate(
      { AttachmentID: attachmentId },
      { ...updateData, UpdatedAt: new Date() },
      { new: true }
    );
    
    if (!attachment) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    res.json(attachment);
  } catch (err) {
    console.error('Error updating attachment:', err);
    res.status(500).json({ error: 'Failed to update attachment' });
  }
});

// Bulk delete attachments
// DELETE /api/attachments/bulk-delete
router.delete('/bulk-delete', async (req, res) => {
  try {
    const { attachmentIds } = req.body;
    
    if (!attachmentIds || !Array.isArray(attachmentIds) || attachmentIds.length === 0) {
      return res.status(400).json({ error: 'Attachment IDs array is required' });
    }

    // Find attachments to get file paths
    const attachments = await Attachment.find({ AttachmentID: { $in: attachmentIds } });
    
    // Ask client to remove physical files via its API (best-effort)
    try {
      const base = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
      for (const attachment of attachments) {
        if (attachment.FileURL) {
          fetch(`${base}/api/local-delete?path=${encodeURIComponent(attachment.FileURL)}`, { method: 'DELETE' }).catch(() => {});
        }
      }
    } catch (_) {}

    // Delete from database
    const result = await Attachment.deleteMany({ AttachmentID: { $in: attachmentIds } });
    
    res.json({ 
      success: true,
      message: `Successfully deleted ${result.deletedCount} attachments`,
      deletedCount: result.deletedCount
    });
  } catch (err) {
    console.error('Error bulk deleting attachments:', err);
    res.status(500).json({ error: 'Failed to delete attachments' });
  }
});

module.exports = router; 