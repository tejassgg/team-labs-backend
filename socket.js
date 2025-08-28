const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('./models/User');
const Project = require('./models/Project');
const TaskDetails = require('./models/TaskDetails');
const Conversation = require('./models/Conversation');
const { formatTime12Hour } = require('./services/dateUtils');

let ioInstance = null;

function getTokenFromHandshake(handshake) {
  // Prefer auth.token, then query.token, then Authorization header
  const authToken = handshake.auth && handshake.auth.token;
  if (authToken) return authToken;
  const queryToken = handshake.query && (handshake.query.token || handshake.query.authToken);
  if (queryToken) return queryToken;
  const headerAuth = handshake.headers && (handshake.headers.authorization || handshake.headers.Authorization);
  if (headerAuth && headerAuth.startsWith('Bearer ')) return headerAuth.split(' ')[1];
  return null;
}

async function authenticateSocket(socket) {
  const token = getTokenFromHandshake(socket.handshake);
  if (!token) {
    throw new Error('No auth token');
  }
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  const user = await User.findById(decoded.id).select('-password');
  if (!user) {
    throw new Error('User not found');
  }
  return user;
}

function initSocket(server) {
  if (ioInstance) return ioInstance;

  const io = new Server(server, {
    path: process.env.SOCKET_IO_PATH || '/socket.io',
    cors: {
      origin: process.env.SOCKET_CORS_ORIGINS ? process.env.SOCKET_CORS_ORIGINS.split(',') : '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
      credentials: true
    }
  });

  io.use(async (socket, next) => {
    try {
      const user = await authenticateSocket(socket);
      socket.data.user = {
        id: user._id.toString(),
        organizationID: user.organizationID,
        role: user.role,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email
      };
      next();
    } catch (err) {
      next(err);
    }
  });

  // In-memory presence map: taskId -> Map(userId -> { name, action })
  const taskPresence = new Map();

  io.on('connection', (socket) => {
    const u = socket.data.user;
    if (u?.organizationID) {
      const orgRoom = `org:${u.organizationID}`;
      socket.join(orgRoom);
      // Also join per-user room for targeted notifications
      socket.join(`user:${u.id}`);
      // Presence online
      io.to(orgRoom).emit('org.member.presence', {
        event: 'org.member.presence',
        version: 1,
        data: {
          organizationId: String(u.organizationID),
          userId: u.id,
          online: true,
          lastActiveAt: new Date().toISOString()
        },
        meta: { emittedAt: new Date().toISOString() }
      });
    }

    socket.on('disconnect', () => {
      const user = socket.data.user;
      if (user?.organizationID) {
        const orgRoom = `org:${user.organizationID}`;
        io.to(orgRoom).emit('org.member.presence', {
          event: 'org.member.presence',
          version: 1,
          data: {
            organizationId: String(user.organizationID),
            userId: user.id,
            online: false,
            lastActiveAt: new Date().toISOString()
          },
          meta: { emittedAt: new Date().toISOString() }
        });
      }
    });

    // Join/leave project rooms with basic org authorization
    socket.on('project.join', async (payload) => {
      try {
        const { projectId } = payload || {};
        if (!projectId) return;
        const proj = await Project.findOne({ ProjectID: projectId });
        if (!proj) return;
        if (String(proj.OrganizationID) !== String(socket.data.user.organizationID)) return;
        socket.join(`project:${projectId}`);
      } catch (_) { /* ignore */ }
    });

    socket.on('project.leave', async (payload) => {
      try {
        const { projectId } = payload || {};
        if (!projectId) return;
        socket.leave(`project:${projectId}`);
      } catch (_) { /* ignore */ }
    });

    // Join/leave task rooms with basic org authorization via project
    socket.on('task.join', async (payload) => {
      try {
        const { taskId } = payload || {};
        if (!taskId) return;
        const task = await TaskDetails.findOne({ TaskID: taskId });
        if (!task) return;
        const proj = await Project.findOne({ ProjectID: task.ProjectID_FK });
        if (!proj) return;
        if (String(proj.OrganizationID) !== String(socket.data.user.organizationID)) return;
        socket.join(`task:${taskId}`);
      } catch (_) {}
    });

    socket.on('task.leave', async (payload) => {
      try {
        const { taskId } = payload || {};
        if (!taskId) return;
        socket.leave(`task:${taskId}`);
      } catch (_) {}
    });

    // Handle subtask events
    socket.on('subtask.join', async (data) => {
      try {
        const { taskId } = data || {};
        if (taskId) {
          socket.join(`task:${taskId}`);
        }
      } catch (error) {
        console.error('Subtask join error:', error);
      }
    });

    socket.on('subtask.leave', async (data) => {
      try {
        const { taskId } = data || {};
        if (taskId) {
          socket.leave(`task:${taskId}`);
        }
      } catch (error) {
        console.error('Subtask leave error:', error);
      }
    });

    // Handle task collaboration events
    socket.on('task.collaboration.join', async (data) => {
      try {
        const { taskId, projectId } = data || {};
        if (taskId) {
          // Join the task room
          socket.join(`task:${taskId}`);

          // Track which tasks this socket has joined for cleanup
          if (!socket.data.tasksJoined) socket.data.tasksJoined = new Set();
          socket.data.tasksJoined.add(String(taskId));

          // Update presence map
          const userId = socket.data.user.id;
          const userName = `${socket.data.user.firstName || ''} ${socket.data.user.lastName || ''}`.trim();
          const usersMap = taskPresence.get(String(taskId)) || new Map();
          usersMap.set(userId, { userId, name: userName, action: 'viewing' });
          taskPresence.set(String(taskId), usersMap);

          // Build full state array
          const users = Array.from(usersMap.values());

          // Send full state to the joining user
          socket.emit('task.collaboration.state', {
            event: 'task.collaboration.state',
            version: 1,
            data: { taskId, users },
            meta: { emittedAt: new Date().toISOString() }
          });

          // Broadcast full state to everyone else in the room
          socket.to(`task:${taskId}`).emit('task.collaboration.state', {
            event: 'task.collaboration.state',
            version: 1,
            data: { taskId, users },
            meta: { emittedAt: new Date().toISOString() }
          });
        }
      } catch (error) {
        console.error('Task collaboration join error:', error);
      }
    });

    socket.on('task.collaboration.leave', async (data) => {
      try {
        const { taskId, projectId } = data || {};
        if (taskId) {
          // Update presence map
          const usersMap = taskPresence.get(String(taskId));
          if (usersMap) {
            usersMap.delete(socket.data.user.id);
            if (usersMap.size === 0) {
              taskPresence.delete(String(taskId));
            } else {
              taskPresence.set(String(taskId), usersMap);
            }
          }

          // Broadcast full state after leaving
          const users = usersMap ? Array.from(usersMap.values()) : [];
          io.to(`task:${taskId}`).emit('task.collaboration.state', {
            event: 'task.collaboration.state',
            version: 1,
            data: { taskId, users },
            meta: { emittedAt: new Date().toISOString() }
          });

          socket.leave(`task:${taskId}`);
        }
      } catch (error) {
        console.error('Task collaboration leave error:', error);
      }
    });

    socket.on('task.collaboration.action', async (data) => {
      try {
        const { taskId, projectId, action } = data || {};
        if (taskId && action) {
          // Update presence map and broadcast full state
          const usersMap = taskPresence.get(String(taskId)) || new Map();
          const userId = socket.data.user.id;
          const userName = `${socket.data.user.firstName || ''} ${socket.data.user.lastName || ''}`.trim();
          usersMap.set(userId, { userId, name: userName, action });
          taskPresence.set(String(taskId), usersMap);

          const users = Array.from(usersMap.values());
          io.to(`task:${taskId}`).emit('task.collaboration.state', {
            event: 'task.collaboration.state',
            version: 1,
            data: { taskId, users },
            meta: { emittedAt: new Date().toISOString() }
          });
        }
      } catch (error) {
        console.error('Task collaboration action error:', error);
      }
    });

    // Cleanup presence on disconnect
    socket.on('disconnect', () => {
      const joined = socket.data.tasksJoined || new Set();
      joined.forEach((taskId) => {
        const usersMap = taskPresence.get(String(taskId));
        if (usersMap) {
          usersMap.delete(socket.data.user.id);
          const users = Array.from(usersMap.values());
          if (usersMap.size === 0) {
            taskPresence.delete(String(taskId));
          } else {
            taskPresence.set(String(taskId), usersMap);
          }
          io.to(`task:${taskId}`).emit('task.collaboration.state', {
            event: 'task.collaboration.state',
            version: 1,
            data: { taskId, users },
            meta: { emittedAt: new Date().toISOString() }
          });
        }
      });
    });

    // Join/leave conversation rooms (must be a participant)
    socket.on('conversation.join', async (payload) => {
      try {
        const { conversationId } = payload || {};
        if (!conversationId) return;
        const convo = await Conversation.findById(conversationId).select('participants');
        if (!convo) return;
        const isParticipant = convo.participants.map(String).includes(String(socket.data.user.id));
        if (!isParticipant) return;
        socket.join(`chat:${conversationId}`);
      } catch (_) {}
    });

    socket.on('conversation.leave', async (payload) => {
      try {
        const { conversationId } = payload || {};
        if (!conversationId) return;
        socket.leave(`chat:${conversationId}`);
      } catch (_) {}
    });

    // Typing indicator relay
    socket.on('chat.typing', (payload) => {
      try {
        const { conversationId, isTyping } = payload || {};
        if (!conversationId) return;
        socket.to(`chat:${conversationId}`).emit('chat.typing', {
          event: 'chat.typing',
          version: 1,
          data: { conversationId, userId: socket.data.user.id, isTyping: !!isTyping },
          meta: { emittedAt: new Date().toISOString() }
        });
      } catch (_) {}
    });

    // Call-related events
    socket.on('call.initiate', async (payload) => {
      try {
        const { recipientId, callerId, conversationId, type, callerName, offer } = payload || {};
        if (!recipientId || !callerId || !conversationId || !type) return;
        
        // Verify the caller is the authenticated user
        if (String(callerId) !== String(socket.data.user.id)) return;
        
        // Verify the conversation exists and caller is a participant
        const convo = await Conversation.findById(conversationId).select('participants');
        if (!convo) return;
        const isParticipant = convo.participants.map(String).includes(String(callerId));
        if (!isParticipant) return;
        
        // Send incoming call notification to recipient with offer
        emitToUser(recipientId, 'call.incoming', {
          event: 'call.incoming',
          version: 1,
          data: {
            callerId,
            callerName,
            type,
            conversationId,
            offer,
            timestamp: new Date().toISOString()
          },
          meta: { emittedAt: new Date().toISOString() }
        });
        
        // Also emit to conversation room for real-time updates
        emitToConversation(conversationId, 'call.initiated', {
          event: 'call.initiated',
          version: 1,
          data: {
            callerId,
            callerName,
            type,
            conversationId,
            timestamp: new Date().toISOString()
          },
          meta: { emittedAt: new Date().toISOString() }
        });
      } catch (error) {
        console.error('Call initiation error:', error);
      }
    });

    socket.on('call.answer', async (payload) => {
      try {
        const { callerId, conversationId, answer } = payload || {};
        if (!callerId || !conversationId) return;
        
        // Verify the user is a participant in the conversation
        const convo = await Conversation.findById(conversationId).select('participants');
        if (!convo) return;
        const isParticipant = convo.participants.map(String).includes(String(socket.data.user.id));
        if (!isParticipant) return;
        
        emitToUser(callerId, 'call.answered', {
          event: 'call.answered',
          version: 1,
          data: {
            conversationId,
            answererId: socket.data.user.id,
            answererName: `${socket.data.user.firstName || ''} ${socket.data.user.lastName || ''}`.trim(),
            answer,
            timestamp: new Date().toISOString()
          },
          meta: { emittedAt: new Date().toISOString() }
        });
        
        // Notify conversation room
        emitToConversation(conversationId, 'call.answered', {
          event: 'call.answered',
          version: 1,
          data: {
            conversationId,
            answererId: socket.data.user.id,
            answererName: `${socket.data.user.firstName || ''} ${socket.data.user.lastName || ''}`.trim(),
            answer,
            timestamp: new Date().toISOString()
          },
          meta: { emittedAt: new Date().toISOString() }
        });
      } catch (error) {
        console.error('Call answer error:', error);
      }
    });

    socket.on('call.decline', async (payload) => {
      try {
        const { callerId, conversationId } = payload || {};
        if (!callerId || !conversationId) return;
        
        // Verify the user is a participant in the conversation
        const convo = await Conversation.findById(conversationId).select('participants');
        if (!convo) return;
        const isParticipant = convo.participants.map(String).includes(String(socket.data.user.id));
        if (!isParticipant) return;
        
        // Save system message for missed call
        const Message = require('./models/Message');
        const caller = await User.findById(callerId).select('firstName lastName');
        const callerName = caller ? `${caller.firstName || ''} ${caller.lastName || ''}`.trim() : 'Unknown User';
        
        // Format time only for missed call message
        const formattedTime = formatTime12Hour();
        
        const systemMessage = await Message.create({
          conversation: conversationId,
          type: 'system',
          text: `Missed call at ${formattedTime}`
        });
        
        // Update conversation with last message info
        convo.lastMessagePreview = systemMessage.text;
        convo.lastMessageAt = systemMessage.createdAt;
        await convo.save();
        
        // Emit system message to conversation
        emitToConversation(conversationId, 'chat.message.created', {
          event: 'chat.message.created',
          version: 1,
          data: {
            conversationId,
            message: systemMessage
          },
          meta: { emittedAt: new Date().toISOString() }
        });
        
        // Notify all participants via per-user rooms for inbox/unread updates
        try {
          const participants = (convo.participants || []).map(String);
          const payload = {
            event: 'chat.inbox.updated',
            version: 1,
            data: {
              conversationId,
              lastMessage: systemMessage,
              updatedAt: new Date().toISOString()
            },
            meta: { emittedAt: new Date().toISOString() }
          };
          participants.forEach((uid) => emitToUser(uid, 'chat.inbox.updated', payload));
        } catch (_) {}
        
        // Notify caller that call was declined
        emitToUser(callerId, 'call.declined', {
          event: 'call.declined',
          version: 1,
          data: {
            conversationId,
            declinerId: socket.data.user.id,
            declinerName: `${socket.data.user.firstName || ''} ${socket.data.user.lastName || ''}`.trim(),
            timestamp: new Date().toISOString()
          },
          meta: { emittedAt: new Date().toISOString() }
        });
        
        // Notify conversation room
        emitToConversation(conversationId, 'call.declined', {
          event: 'call.declined',
          version: 1,
          data: {
            conversationId,
            declinerId: socket.data.user.id,
            declinerName: `${socket.data.user.firstName || ''} ${socket.data.user.lastName || ''}`.trim(),
            timestamp: new Date().toISOString()
          },
          meta: { emittedAt: new Date().toISOString() }
        });
      } catch (error) {
        console.error('Call decline error:', error);
      }
    });

    socket.on('call.end', async (payload) => {
      try {
        const { conversationId, callStartTime, callDuration } = payload || {};
        if (!conversationId) return;
        
        // Verify the user is a participant in the conversation
        const convo = await Conversation.findById(conversationId).select('participants');
        if (!convo) return;
        const isParticipant = convo.participants.map(String).includes(String(socket.data.user.id));
        if (!isParticipant) return;
        
        // Save system message for call ended
        const Message = require('./models/Message');
        
        // Format time for better readability (without date)
        const now = new Date();
        const timeOptions = { 
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        };
        const formattedEndTime = now.toLocaleTimeString('en-US', timeOptions);
        
        // Format start time if provided, otherwise use current time
        let formattedStartTime;
        if (callStartTime) {
          const startDate = new Date(callStartTime);
          formattedStartTime = startDate.toLocaleTimeString('en-US', timeOptions);
        } else {
          formattedStartTime = formattedEndTime;
        }
        
        const systemMessage = await Message.create({
          conversation: conversationId,
          type: 'system',
          text: `📞 Video call started by ${socket.data.user.firstName || ''} ${socket.data.lastName || ''} on ${formattedStartTime} and ended at ${formattedEndTime}. Duration: ${Math.floor(callDuration / 60)}m ${callDuration % 60}s`
        });
        
        // Update conversation with last message info
        convo.lastMessagePreview = systemMessage.text;
        convo.lastMessageAt = systemMessage.createdAt;
        await convo.save();
        
        // Emit system message to conversation
        emitToConversation(conversationId, 'chat.message.created', {
          event: 'chat.message.created',
          version: 1,
          data: {
            conversationId,
            message: systemMessage
          },
          meta: { emittedAt: new Date().toISOString() }
        });
        
        // Notify all participants via per-user rooms for inbox/unread updates
        try {
          const participants = (convo.participants || []).map(String);
          const payload = {
            event: 'chat.inbox.updated',
            version: 1,
            data: {
              conversationId,
              lastMessage: systemMessage,
              updatedAt: new Date().toISOString()
            },
            meta: { emittedAt: new Date().toISOString() }
          };
          participants.forEach((uid) => emitToUser(uid, 'chat.inbox.updated', payload));
        } catch (_) {}
        
        // Notify all participants that call ended
        emitToConversation(conversationId, 'call.ended', {
          event: 'call.ended',
          version: 1,
          data: {
            conversationId,
            endedBy: socket.data.user.id,
            endedByName: `${socket.data.user.firstName || ''} ${socket.data.user.lastName || ''}`.trim(),
            timestamp: new Date().toISOString()
          },
          meta: { emittedAt: new Date().toISOString() }
        });
      } catch (error) {
        console.error('Call end error:', error);
      }
    });

    // Handle missed calls (timeout)
    socket.on('call.missed', async (payload) => {
      try {
        const { conversationId, callerId } = payload || {};
        if (!conversationId || !callerId) return;
        
        // Verify the user is a participant in the conversation
        const convo = await Conversation.findById(conversationId).select('participants');
        if (!convo) return;
        const isParticipant = convo.participants.map(String).includes(String(socket.data.user.id));
        if (!isParticipant) return;
        
        // Save system message for missed call
        const Message = require('./models/Message');
        const caller = await User.findById(callerId).select('firstName lastName');
        const callerName = caller ? `${caller.firstName || ''} ${caller.lastName || ''}`.trim() : 'Unknown User';
        
        // Format time only for missed call message
        const formattedTime = formatTime12Hour();
        
        const systemMessage = await Message.create({
          conversation: conversationId,
          type: 'system',
          text: `Missed call at ${formattedTime}`
        });
        
        // Update conversation with last message info
        convo.lastMessagePreview = systemMessage.text;
        convo.lastMessageAt = systemMessage.createdAt;
        await convo.save();
        
        // Emit system message to conversation
        emitToConversation(conversationId, 'chat.message.created', {
          event: 'chat.message.created',
          version: 1,
          data: {
            conversationId,
            message: systemMessage
          },
          meta: { emittedAt: new Date().toISOString() }
        });
        
        // Notify all participants via per-user rooms for inbox/unread updates
        try {
          const participants = (convo.participants || []).map(String);
          const payload = {
            event: 'chat.inbox.updated',
            version: 1,
            data: {
              conversationId,
              lastMessage: systemMessage,
              updatedAt: new Date().toISOString()
            },
            meta: { emittedAt: new Date().toISOString() }
          };
          participants.forEach((uid) => emitToUser(uid, 'chat.inbox.updated', payload));
        } catch (_) {}
      } catch (error) {
        console.error('Call missed error:', error);
      }
    });

    // Handle ICE candidates for WebRTC
    socket.on('call.ice-candidate', async (payload) => {
      try {
        const { candidate, to, conversationId } = payload || {};
        if (!candidate || !to || !conversationId) return;
        
        // Verify the user is a participant in the conversation
        const convo = await Conversation.findById(conversationId).select('participants');
        if (!convo) return;
        const isParticipant = convo.participants.map(String).includes(String(socket.data.user.id));
        if (!isParticipant) return;
        
        // Forward ICE candidate to the target user
        emitToUser(to, 'call.ice-candidate', {
          event: 'call.ice-candidate',
          version: 1,
          data: {
            candidate,
            from: socket.data.user.id,
            conversationId
          },
          meta: { emittedAt: new Date().toISOString() }
        });
      } catch (error) {
        console.error('ICE candidate error:', error);
      }
    });

    // Handle screen sharing events
    socket.on('call.screen-share.started', async (payload) => {
      try {
        const { to, conversationId } = payload || {};
        if (!to || !conversationId) return;
        
        // Verify the user is a participant in the conversation
        const convo = await Conversation.findById(conversationId).select('participants');
        if (!convo) return;
        const isParticipant = convo.participants.map(String).includes(String(socket.data.user.id));
        if (!isParticipant) return;
        
        // Forward screen share started event to the target user
        emitToUser(to, 'call.screen-share.started', {
          event: 'call.screen-share.started',
          version: 1,
          data: {
            from: socket.data.user.id,
            conversationId,
            startedBy: `${socket.data.user.firstName || ''} ${socket.data.user.lastName || ''}`.trim()
          },
          meta: { emittedAt: new Date().toISOString() }
        });
      } catch (error) {
        console.error('Screen share started error:', error);
      }
    });

    socket.on('call.screen-share.stopped', async (payload) => {
      try {
        const { to, conversationId } = payload || {};
        if (!to || !conversationId) return;
        
        // Verify the user is a participant in the conversation
        const convo = await Conversation.findById(conversationId).select('participants');
        if (!convo) return;
        const isParticipant = convo.participants.map(String).includes(String(socket.data.user.id));
        if (!isParticipant) return;
        
        // Forward screen share stopped event to the target user
        emitToUser(to, 'call.screen-share.stopped', {
          event: 'call.screen-share.stopped',
          version: 1,
          data: {
            from: socket.data.user.id,
            conversationId,
            stoppedBy: `${socket.data.user.firstName || ''} ${socket.data.user.lastName || ''}`.trim()
          },
          meta: { emittedAt: new Date().toISOString() }
        });
      } catch (error) {
        console.error('Screen share stopped error:', error);
      }
    });
  });

  ioInstance = io;
  return ioInstance;
}

function getIO() {
  if (!ioInstance) throw new Error('Socket.io not initialized');
  return ioInstance;
}

function emitToOrg(organizationId, eventName, payload) {
  if (!ioInstance) return;
  ioInstance.to(`org:${organizationId}`).emit(eventName, payload);
}

function emitToProject(projectId, eventName, payload) {
  if (!ioInstance) return;
  ioInstance.to(`project:${projectId}`).emit(eventName, payload);
}

function emitToTask(taskId, eventName, payload) {
  if (!ioInstance) return;
  ioInstance.to(`task:${taskId}`).emit(eventName, payload);
}

function emitToConversation(conversationId, eventName, payload) {
  if (!ioInstance) return;
  ioInstance.to(`chat:${conversationId}`).emit(eventName, payload);
}

function emitToUser(userId, eventName, payload) {
  if (!ioInstance) return;
  ioInstance.to(`user:${userId}`).emit(eventName, payload);
}

module.exports = {
  initSocket,
  getIO,
  emitToOrg,
  emitToProject,
  emitToTask,
  emitToConversation,
  emitToUser
};


