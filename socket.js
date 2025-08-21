const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('./models/User');
const Project = require('./models/Project');
const TaskDetails = require('./models/TaskDetails');
const Conversation = require('./models/Conversation');

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


