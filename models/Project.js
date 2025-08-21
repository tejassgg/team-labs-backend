const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const ProjectSchema = new mongoose.Schema({
  ProjectID: {
    type: String,
    default: uuidv4,
    unique: true
  },
  OrganizationID: {
    type: String,
    required: true
  },
  Name: {
    type: String,
    required: true,
    maxlength: 50
  },
  Description: {
    type: String,
    maxlength: 100
  },
  ProjectOwner: {
    type: String,
    required: true
  },
  IsActive: {
    type: Boolean,
    default: true
  },
  ProjectStatusID: {
    type: Number,
    default: 1 // Default to 'Not Assigned'
  },
  FinishDate: {
    type: Date
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
  },
  // GitHub Repository Integration
  githubRepository: {
    connected: {
      type: Boolean,
      default: false
    },
    repositoryId: {
      type: String,
      default: null
    },
    repositoryName: {
      type: String,
      default: null
    },
    repositoryUrl: {
      type: String,
      default: null
    },
    repositoryFullName: {
      type: String,
      default: null
    },
    repositoryDescription: {
      type: String,
      default: null
    },
    repositoryLanguage: {
      type: String,
      default: null
    },
    repositoryStars: {
      type: Number,
      default: 0
    },
    repositoryForks: {
      type: Number,
      default: 0
    },
    connectedAt: {
      type: Date,
      default: null
    },
    connectedBy: {
      type: String,
      default: null
    }
  }
});

module.exports = mongoose.model('Project', ProjectSchema); 