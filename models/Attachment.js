const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const AttachmentSchema = new mongoose.Schema({
  AttachmentID: {
    type: String,
    default: uuidv4,
    unique: true
  },
  TaskID: {
    type: String,
    required: false
  },
  ProjectID: {
    type: String,
    required: false
  },
  Filename: {
    type: String,
    required: true
  },
  FileURL: {
    type: String,
    required: true
  },
  FileSize: {
    type: Number,
    required: false
  },
  UploadedBy: {
    type: String,
    required: true
  },
  UploadedAt: {
    type: Date,
    default: Date.now
  },
  UpdatedAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Attachment', AttachmentSchema); 