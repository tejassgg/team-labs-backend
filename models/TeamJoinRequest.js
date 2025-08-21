const mongoose = require('mongoose');

const TeamJoinRequestSchema = new mongoose.Schema({
  userId: {
    type: String, // Changed from ObjectId to String for UUID support
    required: true
  },
  teamId: {
    type: String, // Changed from ObjectId to String for UUID support
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected'],
    default: 'pending'
  },
  requestedAt: {
    type: Date,
    default: Date.now
  },
  respondedAt: Date,
  respondedBy: {
    type: String // Changed from ObjectId to String for UUID support
  }
});

module.exports = mongoose.model('TeamJoinRequest', TeamJoinRequestSchema); 