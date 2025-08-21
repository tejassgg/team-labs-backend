const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema(
  {
    name: { type: String, default: '' },
    isGroup: { type: Boolean, default: false },
    avatarUrl: { type: String, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    organizationID: { type: String, required: true },
    participants: [
      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
    ],
    admins: [
      { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
    ],
    leavers: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        leftAt: { type: Date, default: Date.now }
      }
    ],
    lastMessageAt: { type: Date, default: Date.now },
    lastMessagePreview: {
      type: String,
      default: ''
    },
    archived: {
      type: Boolean,
      default: false
    },
    archivedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    archivedAt: {
      type: Date
    }
  },
  { timestamps: true }
);

conversationSchema.index({ organizationID: 1, participants: 1 });
conversationSchema.index({ updatedAt: -1 });

const Conversation = mongoose.model('Conversation', conversationSchema);

module.exports = Conversation;

