const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const SubtaskSchema = new mongoose.Schema({
  SubtaskID: {
    type: String,
    default: uuidv4,
    unique: true
  },
  TaskID_FK: {
    type: String,
    required: true,
    ref: 'TaskDetails'
  },
  Name: {
    type: String,
    required: true,
    maxlength: 100
  },
  IsCompleted: {
    type: Boolean,
    default: false
  },
  CreatedBy: {
    type: String,
    required: true,
    ref: 'User'
  },
  CompletedBy: {
    type: String,
    default: null,
    ref: 'User'
  },
  CreatedDate: {
    type: Date,
    default: Date.now
  },
  CompletedDate: {
    type: Date,
    default: null
  },
  IsActive: {
    type: Boolean,
    default: true
  }
});

// Index for efficient queries
SubtaskSchema.index({ TaskID_FK: 1, IsActive: 1 });
SubtaskSchema.index({ CreatedBy: 1 });
SubtaskSchema.index({ CompletedBy: 1 });

module.exports = mongoose.model('Subtask', SubtaskSchema);
