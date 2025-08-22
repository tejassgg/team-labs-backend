const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');
const connectDB = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const teamRoutes = require('./routes/teamRoutes');
const commonTypeRoutes = require('./routes/commonTypeRoutes');
const teamDetailsRoutes = require('./routes/teamDetailsRoutes');
const projectRoutes = require('./routes/projectRoutes');
const projectDetailsRoutes = require('./routes/projectDetailsRoutes');
const dashboardDetailsRoute = require('./routes/dashboardDetailsRoute');
const userRoutes = require('./routes/userRoutes');
const taskRoutes = require('./routes/taskDetailsRoutes');
const commentRoutes = require('./routes/commentRoutes');
const attachmentRoutes = require('./routes/attachmentRoutes');
const chatbotRoutes = require('./routes/chatbotRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const landingRoutes = require('./routes/landingRoutes');
const swaggerUi = require('swagger-ui-express');
const swaggerSpecs = require('./config/swagger');
const organizationRoutes = require('./routes/organizationRoutes');
const messageRoutes = require('./routes/messageRoutes');

// Load environment variables
dotenv.config();

// Connect to MongoDB
connectDB();

// Initialize app
const app = express();
const server = http.createServer(app);
const { initSocket } = require('./socket');

// Middleware
app.use(express.json());

// Configure CORS
app.use(cors({
  origin: '*', // Allow all origins
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true
}));

app.use(express.urlencoded({ extended: false }));

// Serve static files from uploads directory
app.use('/uploads', express.static(path.join(__dirname, '../client/public/uploads')));

// Swagger UI
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpecs, {
  explorer: true,
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: "TeamLabs API Documentation"
}));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/common-types', commonTypeRoutes);
app.use('/api/team-details', teamDetailsRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/project-details', projectDetailsRoutes);
app.use('/api/dashboard', dashboardDetailsRoute);
app.use('/api/users', userRoutes);
app.use('/api/task-details', taskRoutes);
app.use('/api', commentRoutes);
app.use('/api/attachments', attachmentRoutes);
app.use('/api/chatbot', chatbotRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/landing', landingRoutes);
app.use('/api/organizations', organizationRoutes);
app.use('/api/messages', messageRoutes);

// Test route
app.get('/', (req, res) => {
  res.send('API is running...');
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something went wrong!' });
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  // Initialize WebSocket server after HTTP server starts
  try {
    initSocket(server);
    console.log('Socket.IO initialized');
  } catch (e) {
    console.error('Failed to initialize Socket.IO', e);
  }
  console.log(`Server running on port ${PORT}`);
  console.log(`API Documentation available at http://localhost:${PORT}/api-docs`);
});