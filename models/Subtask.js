const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const SubtaskSchema = new mongoose.Schema({
  SubtaskID: {
    type: String,
    default: uuidv4,
    unique: true
  },
  TaskID: {
    type: String,
    required: true
  },
  Title: {
    type: String,
    required: true,
    maxlength: 100
  },
  IsCompleted: {
    type: Boolean,
    default: false
  },
  CreatedDate: {
    type: Date,
    default: Date.now
  },
  Order: {
    type: Number,
    default: 0
  }
});

module.exports = mongoose.model('Subtask', SubtaskSchema); 