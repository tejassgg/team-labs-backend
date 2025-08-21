const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const { emitToTask, emitToProject } = require('../socket');

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../../client/public/uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Set up multer storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

// File filter to only allow images
const imageFileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed!'), false);
  }
};

// File filter for attachments - allow common file types
const attachmentFileFilter = (req, file, cb) => {
  const allowedMimeTypes = [
    'image/',
    'video/',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv',
    'application/json',
    'application/xml',
    'text/html',
    'text/css',
    'application/javascript',
    'text/javascript'
  ];
  
  const isAllowed = allowedMimeTypes.some(type => 
    file.mimetype.startsWith(type) || file.mimetype === type
  );
  
  if (isAllowed) {
    cb(null, true);
  } else {
    cb(new Error('File type not allowed!'), false);
  }
};

const imageUpload = multer({ 
  storage,
  fileFilter: imageFileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

const attachmentUpload = multer({ 
  storage,
  fileFilter: attachmentFileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit for videos
  }
});

// POST /api/upload
router.post('/', imageUpload.single('image'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }
    // Return the URL relative to the public folder
    const url = `/uploads/${req.file.filename}`;
    res.json({ url });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ 
      message: error.message || 'Error uploading file',
      details: error.stack
    });
  }
});

// POST /api/attachments/upload - Upload task or project attachment
router.post('/attachments/upload', attachmentUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const { taskId, projectId, userId, filename } = req.body;
    
    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
    }

    if (!taskId && !projectId) {
      return res.status(400).json({ message: 'Either Task ID or Project ID is required' });
    }

    // Create attachment record in database
    const Attachment = require('../models/Attachment');
    const attachment = new Attachment({
      TaskID: taskId || null,
      ProjectID: projectId || null,
      Filename: filename || req.file.originalname,
      FileURL: `/uploads/${req.file.filename}`,
      FileSize: req.file.size,
      UploadedBy: userId,
      UploadedAt: new Date()
    });

    await attachment.save();

    // Emit real-time event for task attachments
    try {
      if (taskId) {
        emitToTask(taskId, 'task.attachment.added', {
          event: 'task.attachment.added',
          version: 1,
          data: { taskId, attachment: {
            AttachmentID: attachment.AttachmentID,
            Filename: attachment.Filename,
            FileURL: attachment.FileURL,
            FileSize: attachment.FileSize,
            UploadedAt: attachment.UploadedAt
          } },
          meta: { emittedAt: new Date().toISOString() }
        });
      } else if (projectId) {
        // Optional: emit project-level event if needed later
        try { emitToProject(projectId, 'project.attachment.added', { event: 'project.attachment.added', version: 1, data: { projectId, attachment: {
          AttachmentID: attachment.AttachmentID,
          Filename: attachment.Filename,
          FileURL: attachment.FileURL,
          FileSize: attachment.FileSize,
          UploadedAt: attachment.UploadedAt
        } }, meta: { emittedAt: new Date().toISOString() } }); } catch (e) {}
      }
    } catch (e) { }

    // Log activity for attachment upload
    const { logActivity } = require('../services/activityService');
    let details = '';
    let metadata = {
      fileName: attachment.Filename,
      fileUrl: attachment.FileURL,
      fileSize: attachment.FileSize,
      attachmentId: attachment.AttachmentID
    };
    if (taskId) {
      // Try to fetch task name/type for better details
      try {
        const TaskDetails = require('../models/TaskDetails');
        const task = await TaskDetails.findOne({ TaskID: taskId });
        details = `Added attachment "${attachment.Filename}" to task "${task ? task.Name : taskId}"`;
        metadata.taskId = taskId;
        if (task) {
          metadata.taskName = task.Name;
          metadata.taskType = task.Type;
          metadata.projectId = task.ProjectID_FK;
        }
      } catch (e) {
        details = `Added attachment "${attachment.Filename}" to task (ID: ${taskId})`;
        metadata.taskId = taskId;
      }
    } else if (projectId) {
      // Try to fetch project name for better details
      try {
        const Project = require('../models/Project');
        const project = await Project.findOne({ ProjectID: projectId });
        details = `Added attachment "${attachment.Filename}" to project "${project ? project.Name : projectId}"`;
        metadata.projectId = projectId;
        if (project) {
          metadata.projectName = project.Name;
        }
      } catch (e) {
        details = `Added attachment "${attachment.Filename}" to project (ID: ${projectId})`;
        metadata.projectId = projectId;
      }
    }
    await logActivity(
      userId,
      'attachment_added',
      'success',
      details,
      req,
      metadata
    );

    res.json({ 
      success: true,
      message: 'File uploaded successfully',
      attachment: {
        AttachmentID: attachment.AttachmentID,
        Filename: attachment.Filename,
        FileURL: attachment.FileURL,
        FileSize: attachment.FileSize,
        UploadedAt: attachment.UploadedAt
      }
    });
  } catch (error) {
    console.error('Attachment upload error:', error);
    res.status(500).json({ 
      success: false,
      message: error.message || 'Error uploading attachment',
      details: error.stack
    });
  }
});


// POST /api/upload/chat/upload - Upload chat media (image/video) and return URL only
router.post('/chat/upload', attachmentUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }
    const url = `/uploads/${req.file.filename}`;
    res.json({ success: true, url });
  } catch (error) {
    console.error('Chat media upload error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error uploading chat media' });
  }
});



module.exports = router; 