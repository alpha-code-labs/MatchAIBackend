// Load environment variables
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');

// Initialize Firebase when server starts
require('./src/config/firebase');

// Import matching system
const matchingRoutes = require('./src/routes/matching');
const DailyMatchingJob = require('./src/jobs/dailyMatchingJob');

// Import email notification system
const emailRoutes = require('./src/routes/emailRoutes');
const { emailNotificationJob } = require('./src/controllers/emailController');
const chatRoutes = require('./src/routes/chatRoutes');

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(helmet());
app.use(compression());
app.use(morgan('combined'));

// CORS Configuration
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    // In production, you should whitelist specific domains
    // For now, allowing all origins - UPDATE THIS WITH YOUR DOMAINS
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  exposedHeaders: ['X-Total-Count', 'X-Page-Count'],
  maxAge: 86400 // 24 hours
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    message: 'Dating App Backend is running',
    timestamp: new Date().toISOString()
  });
});

// Routes
app.use('/api/users', require('./src/routes/userRoutes'));
app.use('/api/questions', require('./src/routes/questionRoutes'));
app.use('/api/matching', matchingRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/chat', chatRoutes);

// Initialize and start cron jobs
const startCronJobs = () => {
  try {
    // Start daily matching job (6:00 AM IST)
    const dailyMatchingJob = new DailyMatchingJob();
    dailyMatchingJob.start();
    
    // Start email notification job (8:00 AM IST - 2 hours after matching)
    emailNotificationJob.start();
    
    console.log('✅ Cron jobs initialized successfully');
    console.log('   • Daily matching: 6:00 AM IST');
    console.log('   • Email notifications: 8:00 AM IST');
    
    // Store job instances for graceful shutdown
    app.locals.dailyMatchingJob = dailyMatchingJob;
    app.locals.emailNotificationJob = emailNotificationJob;
    
  } catch (error) {
    console.error('❌ Error starting cron jobs:', error);
  }
};

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    status: 'error',
    message: 'Route not found'
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Global error handler:', err);
  res.status(err.status || 500).json({
    status: 'error',
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Graceful shutdown handlers
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  
  // Stop daily matching job
  if (app.locals.dailyMatchingJob) {
    app.locals.dailyMatchingJob.stop();
  }
  
  // Stop email notification job
  if (app.locals.emailNotificationJob) {
    app.locals.emailNotificationJob.stop();
  }
  
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully...');
  
  // Stop daily matching job
  if (app.locals.dailyMatchingJob) {
    app.locals.dailyMatchingJob.stop();
  }
  
  // Stop email notification job
  if (app.locals.emailNotificationJob) {
    app.locals.emailNotificationJob.stop();
  }
  
  process.exit(0);
});

// Start server
const HOST = '0.0.0.0'; // Listen on all network interfaces
app.listen(PORT, HOST, () => {
  console.log(`
╔════════════════════════════════════════════╗
║       Match.AI Backend Server Started      ║
╚════════════════════════════════════════════╝

🚀 Server: http://${HOST}:${PORT}
🌍 Environment: ${process.env.NODE_ENV || 'production'}
📅 Started: ${new Date().toISOString()}

Services Active:
   ✓ User Management
   ✓ Question System  
   ✓ Matching Engine
   ✓ Email Notifications
   ✓ Chat System
`);
  
  // Start cron jobs after server is running
  startCronJobs();
});

module.exports = app;