const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const ProjectDetailsSchema = new mongoose.Schema({
  ProjectID: {
    type: String,
    required: true
  },
  TeamID: {
    type: String,
    required: true
  },
  IsActive: {
    type: Boolean,
    default: true
  },
  CreatedDate: {
    type: Date,
    default: Date.now
  },
  ModifiedDate: {
    type: Date
  },
  ModifiedBy: {
    type: String,
    maxlength: 50
  }
});

module.exports = mongoose.model('ProjectDetails', ProjectDetailsSchema); 