const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const CommentSchema = new mongoose.Schema({
  CommentID: {
    type: String,
    default: uuidv4,
    unique: true
  },
  TaskID: {
    type: String,
    required: true
  },
  Author: {
    type: String,
    required: true
  },
  Content: {
    type: String,
    required: true,
    maxlength: 1000
  },
  CreatedAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Comment', CommentSchema); 