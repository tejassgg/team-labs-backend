const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['user', 'bot'],
    required: true
  },
  content: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
    validate: {
      validator: function(value) {
        // Allow string content
        if (typeof value === 'string') return true;
        
        // Allow object content with text and optional links
        if (typeof value === 'object' && value !== null) {
          return typeof value.text === 'string' && 
                 (!value.links || Array.isArray(value.links));
        }
        
        return false;
      },
      message: 'Content must be either a string or an object with text and optional links'
    }
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

const chatConversationSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  messages: [messageSchema],
  lastInteraction: {
    type: Date,
    default: Date.now
  },
  status: {
    type: String,
    enum: ['active', 'archived'],
    default: 'active'
  }
}, {
  timestamps: true
});

// Index for faster queries
chatConversationSchema.index({ user: 1, lastInteraction: -1 });
chatConversationSchema.index({ status: 1 });

const ChatConversation = mongoose.model('ChatConversation', chatConversationSchema);

module.exports = ChatConversation; 