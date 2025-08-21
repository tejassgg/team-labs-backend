const express = require('express');
const mongoose = require('mongoose');
const { protect } = require('../middleware/auth');
const { emitToConversation, emitToOrg, emitToUser } = require('../socket');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const User = require('../models/User');

const router = express.Router();

// Get conversations for current user's organization
router.get('/conversations', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const { includeArchived = false } = req.query;
    
    const query = {
      organizationID: user.organizationID,
      $or: [
        { participants: req.user._id },
        { 'leavers.user': req.user._id }
      ]
    };
    
    // Only include archived conversations if explicitly requested
    if (!includeArchived) {
      query.archived = { $ne: true };
    }
    
    const conversations = await Conversation.find(query)
      .sort({ updatedAt: -1 })
      .populate('participants', 'firstName lastName email profileImage')
      .lean();
    // Mark and filter conversations where user is no longer a member
    const withMembershipFlag = conversations.map(c => ({
      ...c,
      isMember: (c.participants || []).some(p => String(p._id || p) === String(req.user._id))
    }));

    // Attach unread counts per conversation for this user
    const withUnreadCounts = await Promise.all(withMembershipFlag.map(async (c) => {
      try {
        const unreadCount = await Message.countDocuments({
          conversation: c._id,
          // Do not count system messages for unread since they are informational
          type: { $ne: 'system' },
          // Do not count own messages
          sender: { $ne: req.user._id },
          // Only messages not read by this user
          readBy: { $ne: req.user._id }
        });
        return { ...c, unreadCount };
      } catch (_) {
        return { ...c, unreadCount: 0 };
      }
    }));

    res.json(withUnreadCounts);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch conversations' });
  }
});

// Get archived conversations for current user's organization
router.get('/conversations/archived', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    
    const conversations = await Conversation.find({
      organizationID: user.organizationID,
      participants: req.user._id,
      archived: true
    })
      .sort({ archivedAt: -1 })
      .populate('participants', 'firstName lastName email profileImage');
    res.json(conversations);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch archived conversations' });
  }
});

// Create one-to-one conversation or get existing
router.post('/conversations/with/:userId', protect, async (req, res) => {
  try {
    const otherUserId = req.params.userId;
    const currentUser = await User.findById(req.user._id);
    const otherUser = await User.findById(otherUserId);
    if (!otherUser || otherUser.organizationID !== currentUser.organizationID) {
      return res.status(400).json({ message: 'User not in the same organization' });
    }

    let conversation = await Conversation.findOne({
      isGroup: false,
      organizationID: currentUser.organizationID,
      participants: { $all: [req.user._id, otherUserId], $size: 2 }
    });

    let wasCreated = false;
    if (!conversation) {
      conversation = await Conversation.create({
        isGroup: false,
        organizationID: currentUser.organizationID,
        participants: [req.user._id, otherUserId]
      });
      wasCreated = true;
    }

    const populated = await Conversation.findById(conversation._id).populate('participants', 'firstName lastName email profileImage');

    // Emit real-time event on first creation so the other participant sees the new DM appear
    try {
      if (wasCreated) {
        emitToOrg(currentUser.organizationID, 'chat.conversation.created', {
          event: 'chat.conversation.created',
          version: 1,
          data: { conversation: populated },
          meta: { emittedAt: new Date().toISOString() }
        });
      }
    } catch (_) {}
    res.json(populated);
  } catch (err) {
    res.status(500).json({ message: 'Failed to create conversation' });
  }
});

// Create group conversation
router.post('/conversations', protect, async (req, res) => {
  try {
    const { name, participantIds = [], avatarUrl } = req.body;
    const currentUser = await User.findById(req.user._id);
    // De-duplicate and exclude creator if provided by client
    const uniqueIds = Array.from(new Set(participantIds.map(id => String(id)))).filter(id => id !== String(req.user._id));
    const users = await User.find({ _id: { $in: uniqueIds } });
    const allSameOrg = users.every(u => u.organizationID === currentUser.organizationID);
    if (!allSameOrg) {
      return res.status(400).json({ message: 'All participants must be in the same organization' });
    }

    const conversation = await Conversation.create({
      name: name || 'New Group',
      isGroup: true,
      organizationID: currentUser.organizationID,
      participants: [req.user._id, ...users.map(u => u._id)],
      admins: [req.user._id],
      avatarUrl: avatarUrl || '',
      createdBy: req.user._id
    });

    // Create system messages for all participants added to the group (excluding creator)
    const systemMessages = [];
    for (const user of users) {
      if (String(user._id) !== String(req.user._id)) {
        const systemMessage = await Message.create({
          conversation: conversation._id,
          type: 'system',
          text: `${user.firstName} ${user.lastName} added to the group`
        });
        systemMessages.push(systemMessage);
        // Emit system message in real-time
        try {
          emitToConversation(String(conversation._id), 'chat.message.created', {
            event: 'chat.message.created',
            version: 1,
            data: { conversationId: String(conversation._id), message: systemMessage },
            meta: { emittedAt: new Date().toISOString() }
          });
        } catch (_) {}
      }
    }

    // Update conversation with last message info if there are system messages
    if (systemMessages.length > 0) {
      const lastMessage = systemMessages[systemMessages.length - 1];
      conversation.lastMessagePreview = lastMessage.text;
      conversation.lastMessageAt = lastMessage.createdAt;
      await conversation.save();
    }

    const populated = await Conversation.findById(conversation._id).populate('participants', 'firstName lastName email profileImage');
    // Emit to org so all eligible clients can update; clients will filter by membership
    try {
      emitToOrg(currentUser.organizationID, 'chat.conversation.created', {
        event: 'chat.conversation.created',
        version: 1,
        data: { conversation: populated },
        meta: { emittedAt: new Date().toISOString() }
      });
    } catch (_) {}
    res.status(201).json(populated);
  } catch (err) {
    console.error('Error creating group:', err);
    res.status(500).json({ message: 'Failed to create group' });
  }
});

// Get conversation details (with members)
router.get('/conversations/:conversationId', protect, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const conversation = await Conversation.findById(conversationId)
      .populate('participants', 'firstName lastName email profileImage')
      .populate('createdBy', 'firstName lastName email')
      .lean();
    if (!conversation) return res.status(404).json({ message: 'Conversation not found' });
    res.json(conversation);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch conversation' });
  }
});

// Add members to a group conversation
router.post('/conversations/:conversationId/members', protect, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { memberIds } = req.body;
    const conversation = await Conversation.findById(conversationId);
    if (!conversation || !conversation.isGroup) return res.status(404).json({ message: 'Group not found' });
    // Only allow members of same org
    const currentUser = await User.findById(req.user._id);
    const newUsers = await User.find({ _id: { $in: memberIds } });
    const allSameOrg = newUsers.every(u => u.organizationID === currentUser.organizationID);
    if (!allSameOrg) return res.status(400).json({ message: 'Members must be in the same organization' });
    
    // Track which users are actually new to avoid duplicate system messages
    const existing = new Set(conversation.participants.map(String));
    const actuallyNewUsers = newUsers.filter(u => !existing.has(String(u._id)));
    
    // Add new users to participants
    actuallyNewUsers.forEach(u => existing.add(String(u._id)));
    conversation.participants = Array.from(existing);
    await conversation.save();

    // Notify participants about membership update
    try {
      const updated = await Conversation.findById(conversation._id).select('participants');
      emitToConversation(String(conversation._id), 'chat.conversation.updated', {
        event: 'chat.conversation.updated',
        version: 1,
        data: { conversationId: String(conversation._id), participants: updated.participants },
        meta: { emittedAt: new Date().toISOString() }
      });
      
      // Also emit to organization room so other users see the conversation list update
      emitToOrg(currentUser.organizationID, 'chat.conversation.updated', {
        event: 'chat.conversation.updated',
        version: 1,
        data: { conversationId: String(conversation._id), participants: updated.participants },
        meta: { emittedAt: new Date().toISOString() }
      });
    } catch (_) {}

    // Create system messages for actually new members
    const systemMessages = [];
    for (const user of actuallyNewUsers) {
      const systemMessage = await Message.create({
        conversation: conversationId,
        type: 'system',
        text: `${user.firstName} ${user.lastName} added to the group`
      });
      systemMessages.push(systemMessage);
      // Emit system message in real-time
      try {
        emitToConversation(String(conversationId), 'chat.message.created', {
          event: 'chat.message.created',
          version: 1,
          data: { conversationId: String(conversationId), message: systemMessage },
          meta: { emittedAt: new Date().toISOString() }
        });
        // Notify all participants via per-user rooms for inbox/unread updates
        try {
          const participants = (conversation.participants || []).map(String);
          const payload = {
            event: 'chat.inbox.updated',
            version: 1,
            data: {
              conversationId: String(conversationId),
              lastMessage: systemMessage,
              updatedAt: new Date().toISOString()
            },
            meta: { emittedAt: new Date().toISOString() }
          };
          participants.forEach((uid) => emitToUser(uid, 'chat.inbox.updated', payload));
        } catch (_) {}
      } catch (_) {}
    }

    // Update conversation with last message info if there are system messages
    if (systemMessages.length > 0) {
      const lastMessage = systemMessages[systemMessages.length - 1];
      conversation.lastMessagePreview = lastMessage.text;
      conversation.lastMessageAt = lastMessage.createdAt;
      await conversation.save();
    }

    const populated = await Conversation.findById(conversation._id).populate('participants', 'firstName lastName email profileImage').lean();
    res.json(populated);
  } catch (err) {
    console.error('Error adding members:', err);
    res.status(500).json({ message: 'Failed to add members' });
  }
});

// Remove members from a group conversation
router.delete('/conversations/:conversationId/members', protect, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { memberIds } = req.body;
    
    const conversation = await Conversation.findById(conversationId);
    if (!conversation || !conversation.isGroup) {
      return res.status(404).json({ message: 'Group not found' });
    }

    // Check if user is a participant in the conversation
    if (!conversation.participants.map(String).includes(String(req.user._id))) {
      return res.status(403).json({ message: 'Not authorized to modify this conversation' });
    }

    // Remove the specified members and record leave
    const toRemove = new Set((memberIds || []).map(String));
    const remaining = [];
    const now = new Date();
    conversation.leavers = conversation.leavers || [];
    for (const pid of conversation.participants) {
      if (toRemove.has(String(pid))) {
        conversation.leavers.push({ user: pid, leftAt: now });
        // Emit system message in real-time
        try {
          const u = await User.findById(pid).select('firstName lastName');
          const sys = await Message.create({ conversation: conversation._id, type: 'system', text: `${u?.firstName || ''} ${u?.lastName || ''} removed from the group`.trim() });
          emitToConversation(String(conversation._id), 'chat.message.created', {
            event: 'chat.message.created',
            version: 1,
            data: { conversationId: String(conversation._id), message: sys },
            meta: { emittedAt: new Date().toISOString() }
          });
        } catch (_) {}
      } else {
        remaining.push(pid);
      }
    }
    conversation.participants = remaining;

    // If removing members would leave the group with less than 2 participants, keep the group; do not delete

    await conversation.save();
    
    const populated = await Conversation.findById(conversation._id)
      .populate('participants', 'firstName lastName email profileImage')
      .lean();
    
    res.json(populated);
  } catch (err) {
    console.error('Error removing members:', err);
    res.status(500).json({ message: 'Failed to remove members' });
  }
});

// Leave a conversation (for users to leave a group)
router.post('/conversations/:conversationId/leave', protect, async (req, res) => {
  try {
    const { conversationId } = req.params;
    
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    // Check if user is a participant in the conversation
    if (!conversation.participants.map(String).includes(String(req.user._id))) {
      return res.status(403).json({ message: 'Not a participant in this conversation' });
    }

    // For direct messages, return error (can't leave 1-on-1 chats)
    if (!conversation.isGroup) {
      return res.status(400).json({ message: 'Cannot leave direct message conversations' });
    }

    // Remove the current user from participants and record leave
    conversation.participants = conversation.participants.filter(
      participantId => String(participantId) !== String(req.user._id)
    );
    conversation.leavers = conversation.leavers || [];
    conversation.leavers.push({ user: req.user._id, leftAt: new Date() });
    // Emit system message in real-time for leaving
    try {
      const u = await User.findById(req.user._id).select('firstName lastName');
      const sys = await Message.create({ conversation: conversation._id, type: 'system', text: `${u?.firstName || ''} ${u?.lastName || ''} left the group`.trim() });
      await Message.save();
      emitToConversation(String(conversation._id), 'chat.message.created', {
        event: 'chat.message.created',
        version: 1,
        data: { conversationId: String(conversation._id), message: sys },
        meta: { emittedAt: new Date().toISOString() }
      });
      // Inbox updates for leave system message
      try {
        const participants = (conversation.participants || []).map(String);
        const payload = {
          event: 'chat.inbox.updated',
          version: 1,
          data: {
            conversationId: String(conversation._id),
            lastMessage: sys,
            updatedAt: new Date().toISOString()
          },
          meta: { emittedAt: new Date().toISOString() }
        };
        participants.forEach((uid) => emitToUser(uid, 'chat.inbox.updated', payload));
      } catch (_) {}
      // Inbox updates
      try {
        const participants = (conversation.participants || []).map(String);
        const payload = {
          event: 'chat.inbox.updated',
          version: 1,
          data: {
            conversationId: String(conversation._id),
            lastMessage: sys,
            updatedAt: new Date().toISOString()
          },
          meta: { emittedAt: new Date().toISOString() }
        };
        participants.forEach((uid) => emitToUser(uid, 'chat.inbox.updated', payload));
      } catch (_) {}
    } catch (_) {}

    // Emit membership update
    try {
      const updated = await Conversation.findById(conversation._id).select('participants');
      emitToConversation(String(conversation._id), 'chat.conversation.updated', {
        event: 'chat.conversation.updated',
        version: 1,
        data: { conversationId: String(conversation._id), participants: updated.participants },
        meta: { emittedAt: new Date().toISOString() }
      });
    } catch (_) {}

    await conversation.save();
    
    const populated = await Conversation.findById(conversation._id)
      .populate('participants', 'firstName lastName email profileImage')
      .lean();
    
    res.json(populated);
  } catch (err) {
    console.error('Error leaving conversation:', err);
    res.status(500).json({ message: 'Failed to leave conversation' });
  }
});

// Get conversation statistics (for admin purposes)
router.get('/conversations/:conversationId/stats', protect, async (req, res) => {
  try {
    const { conversationId } = req.params;
    
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    // Check if user is a participant in the conversation
    if (!conversation.participants.map(String).includes(String(req.user._id))) {
      return res.status(403).json({ message: 'Not authorized to view this conversation' });
    }

    // Get message count
    const messageCount = await Message.countDocuments({ conversation: conversationId });
    
    // Get participant count
    const participantCount = conversation.participants.length;
    
    // Get last message info
    const lastMessage = await Message.findOne({ conversation: conversationId })
      .sort({ createdAt: -1 })
      .select('createdAt sender')
      .populate('sender', 'firstName lastName');

    res.json({
      conversationId,
      name: conversation.name,
      isGroup: conversation.isGroup,
      participantCount,
      messageCount,
      lastMessage: lastMessage ? {
        createdAt: lastMessage.createdAt,
        sender: lastMessage.sender
      } : null,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt
    });
  } catch (err) {
    console.error('Error fetching conversation stats:', err);
    res.status(500).json({ message: 'Failed to fetch conversation statistics' });
  }
});

// Get files and links referenced in messages
router.get('/conversations/:conversationId/assets', protect, async (req, res) => {
  try {
    const { conversationId } = req.params;
    // Apply leaver time restriction similar to messages endpoint
    const convo = await Conversation.findById(conversationId).select('leavers participants');
    if (!convo) return res.status(404).json({ message: 'Conversation not found' });
    const isParticipant = convo.participants.map(String).includes(String(req.user._id));
    let timeFilter = {};
    if (!isParticipant && Array.isArray(convo.leavers)) {
      const leaveRec = convo.leavers.find(l => String(l.user) === String(req.user._id));
      if (leaveRec) {
        timeFilter = { createdAt: { $lte: leaveRec.leftAt } };
      } else {
        return res.status(403).json({ message: 'Not authorized to view assets' });
      }
    }
    const messages = await Message.find({ conversation: conversationId, ...timeFilter }).lean();
    const files = messages.filter(m => m.mediaUrl).map(m => ({
      _id: m._id,
      url: m.mediaUrl,
      type: m.type,
      createdAt: m.createdAt,
      sender: m.sender,
    }));
    const linkRegex = /(https?:\/\/[^\s]+)/gi;
    const links = [];
    messages.forEach(m => {
      if (m.text) {
        const found = m.text.match(linkRegex);
        if (found) found.forEach(url => links.push({ url, messageId: m._id, createdAt: m.createdAt }));
      }
    });
    res.json({ files, links });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch assets' });
  }
});

// Get messages in a conversation
router.get('/conversations/:conversationId/messages', protect, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { page = 1, limit = 30 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    // If user has left, restrict messages to before their leftAt
    const convo = await Conversation.findById(conversationId).select('leavers participants');
    const isParticipant = convo && convo.participants.map(String).includes(String(req.user._id));
    let timeFilter = {};
    if (!isParticipant && convo && Array.isArray(convo.leavers)) {
      const leaveRec = convo.leavers.find(l => String(l.user) === String(req.user._id));
      if (leaveRec) {
        timeFilter = { createdAt: { $lte: leaveRec.leftAt } };
      } else {
        // Not participant and no leave record -> forbid
        return res.status(403).json({ message: 'Not authorized to view messages' });
      }
    }
    const messages = await Message.find({ conversation: conversationId, ...timeFilter })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('sender', 'firstName lastName email profileImage')
      .lean();
    res.json(messages.reverse());
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch messages' });
  }
});

// Send a message (text or media)
router.post('/conversations/:conversationId/messages', protect, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { type, text = '', mediaUrl = '' } = req.body;

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) return res.status(404).json({ message: 'Conversation not found' });
    const isParticipant = conversation.participants.map(String).includes(String(req.user._id));
    const leaverRec = (conversation.leavers || []).find(l => String(l.user) === String(req.user._id));
    if (!isParticipant) {
      // If user left/was removed, block sending
      return res.status(403).json({ message: 'You are no longer a participant in this conversation' });
    }

    const messageData = {
      conversation: conversationId,
      type: type || (mediaUrl ? 'image' : 'text'),
      text,
      mediaUrl
    };

    // Only add sender for non-system messages
    if (type !== 'system') {
      messageData.sender = req.user._id;
      // The sender has implicitly read their own message
      messageData.readBy = [req.user._id];
    }

    const message = await Message.create(messageData);

    conversation.lastMessageAt = new Date();
    conversation.lastMessagePreview = text || (message.type === 'image' ? 'Image' : message.type === 'video' ? 'Video' : message.type === 'system' ? text : '');
    await conversation.save();

    const populated = await Message.findById(message._id).populate('sender', 'firstName lastName email profileImage');
    try {
      emitToConversation(conversationId, 'chat.message.created', {
        event: 'chat.message.created',
        version: 1,
        data: {
          conversationId,
          message: populated
        },
        meta: { emittedAt: new Date().toISOString() }
      });
      // Notify all participants via per-user rooms for inbox/unread updates
      try {
        const participants = (conversation.participants || []).map(String);
        const payload = {
          event: 'chat.inbox.updated',
          version: 1,
          data: {
            conversationId,
            lastMessage: populated,
            updatedAt: new Date().toISOString()
          },
          meta: { emittedAt: new Date().toISOString() }
        };
        participants.forEach((uid) => emitToUser(uid, 'chat.inbox.updated', payload));
      } catch (_) {}
    } catch (_) {}
    res.status(201).json(populated);
  } catch (err) {
    res.status(500).json({ message: 'Failed to send message' });
  }
});

// Mark all messages in a conversation as read by current user
router.post('/conversations/:conversationId/read', protect, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const convo = await Conversation.findById(conversationId).select('participants');
    if (!convo) return res.status(404).json({ message: 'Conversation not found' });
    const isParticipant = (convo.participants || []).map(String).includes(String(req.user._id));
    if (!isParticipant) return res.status(403).json({ message: 'Not authorized' });

    // Mark messages as read (excluding system and own messages)
    await Message.updateMany(
      {
        conversation: conversationId,
        type: { $ne: 'system' },
        sender: { $ne: req.user._id },
        readBy: { $ne: req.user._id }
      },
      { $addToSet: { readBy: req.user._id } }
    );

    // Calculate remaining unread for this user after update
    const unreadCount = await Message.countDocuments({
      conversation: conversationId,
      type: { $ne: 'system' },
      sender: { $ne: req.user._id },
      readBy: { $ne: req.user._id }
    });

    // Emit a personal inbox update so other tabs/devices of this user reset the badge
    try {
      const payload = {
        event: 'chat.inbox.updated',
        version: 1,
        data: { conversationId: String(conversationId), unreadCount },
        meta: { emittedAt: new Date().toISOString() }
      };
      emitToUser(String(req.user._id), 'chat.inbox.updated', payload);
    } catch (_) {}

    // Notify conversation participants of read receipts up to now
    try {
      emitToConversation(String(conversationId), 'chat.messages.read', {
        event: 'chat.messages.read',
        version: 1,
        data: {
          conversationId: String(conversationId),
          readerId: String(req.user._id),
          upTo: new Date().toISOString()
        },
        meta: { emittedAt: new Date().toISOString() }
      });
    } catch (_) {}

    res.json({ conversationId: String(conversationId), unreadCount });
  } catch (err) {
    res.status(500).json({ message: 'Failed to mark conversation as read' });
  }
});

// React to a message (only one reaction per user)
router.post('/messages/:messageId/reactions', protect, async (req, res) => {
  try {
    const { emoji } = req.body;
    const { messageId } = req.params;
    const message = await Message.findById(messageId);
    if (!message) return res.status(404).json({ message: 'Message not found' });

    // Ensure only one reaction per user:
    // - If the same emoji is already set by the user, remove it (toggle off)
    // - If a different emoji exists by the user, replace it with the new one
    const userIdStr = String(req.user._id);
    const existingByUserIdx = message.reactions.findIndex(r => String(r.user) === userIdStr);
    if (existingByUserIdx >= 0) {
      const existing = message.reactions[existingByUserIdx];
      if (existing.emoji === emoji) {
        // toggle off
        message.reactions.splice(existingByUserIdx, 1);
      } else {
        // replace
        message.reactions[existingByUserIdx].emoji = emoji;
      }
    } else {
      message.reactions.push({ emoji, user: req.user._id });
    }
    await message.save();
    const populated = await Message.findById(message._id).populate('sender', 'firstName lastName email profileImage');
    res.json(populated);
  } catch (err) {
    res.status(500).json({ message: 'Failed to update reaction' });
  }
});

// Delete a conversation (only group conversations)
router.delete('/conversations/:conversationId', protect, async (req, res) => {
  try {
    const { conversationId } = req.params;
    
    // Find the conversation
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    // Only allow deletion of group conversations
    if (!conversation.isGroup) {
      return res.status(400).json({ message: 'Only group conversations can be deleted' });
    }

    // Check if user is a participant in the conversation
    if (!conversation.participants.map(String).includes(String(req.user._id))) {
      return res.status(403).json({ message: 'Not authorized to delete this conversation' });
    }

    // Delete all messages from the conversation
    await Message.deleteMany({ conversation: conversationId });

    // Delete the conversation itself
    await Conversation.findByIdAndDelete(conversationId);

    // Emit real-time deletion to org so participants can remove it from UI
    try {
      emitToOrg(conversation.organizationID, 'chat.conversation.deleted', {
        event: 'chat.conversation.deleted',
        version: 1,
        data: { conversationId },
        meta: { emittedAt: new Date().toISOString() }
      });
    } catch (_) {}

    res.json({ message: 'Conversation and all messages deleted successfully' });
  } catch (err) {
    console.error('Error deleting conversation:', err);
    res.status(500).json({ message: 'Failed to delete conversation' });
  }
});

// Update conversation details (name, etc.)
router.patch('/conversations/:conversationId', protect, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { name } = req.body;
    
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    // Check if user is a participant in the conversation
    if (!conversation.participants.map(String).includes(String(req.user._id))) {
      return res.status(403).json({ message: 'Not authorized to update this conversation' });
    }

    // Only allow updating group conversations
    if (!conversation.isGroup) {
      return res.status(400).json({ message: 'Cannot update direct message conversations' });
    }

    // Update the conversation name
    if (name !== undefined) {
      conversation.name = name.trim();
      conversation.updatedAt = new Date();
    }
    
    await conversation.save();
    
    // Emit real-time update to conversation participants
    try {
      emitToConversation(String(conversationId), 'chat.conversation.updated', {
        event: 'chat.conversation.updated',
        version: 1,
        data: { 
          conversationId: String(conversationId), 
          name: conversation.name,
          updatedAt: conversation.updatedAt
        },
        meta: { emittedAt: new Date().toISOString() }
      });
      
      // Also emit to organization room so other users see the conversation list update
      emitToOrg(conversation.organizationID, 'chat.conversation.updated', {
        event: 'chat.conversation.updated',
        version: 1,
        data: { 
          conversationId: String(conversationId), 
          name: conversation.name,
          updatedAt: conversation.updatedAt
        },
        meta: { emittedAt: new Date().toISOString() }
      });
    } catch (_) {}
    
    const populated = await Conversation.findById(conversation._id)
      .populate('participants', 'firstName lastName email profileImage')
      .populate('createdBy', 'firstName lastName email')
      .lean();
    
    res.json(populated);
  } catch (err) {
    console.error('Error updating conversation:', err);
    res.status(500).json({ message: 'Failed to update conversation' });
  }
});

// Archive a conversation (soft delete - keeps data but hides from active conversations)
router.post('/conversations/:conversationId/archive', protect, async (req, res) => {
  try {
    const { conversationId } = req.params;
    
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    // Check if user is a participant in the conversation
    if (!conversation.participants.map(String).includes(String(req.user._id))) {
      return res.status(403).json({ message: 'Not authorized to archive this conversation' });
    }

    // Add archived flag and archived by user
    conversation.archived = true;
    conversation.archivedBy = req.user._id;
    conversation.archivedAt = new Date();
    
    await conversation.save();
    
    res.json({ message: 'Conversation archived successfully' });
  } catch (err) {
    console.error('Error archiving conversation:', err);
    res.status(500).json({ message: 'Failed to archive conversation' });
  }
});

module.exports = router;