const express = require('express');
const router = express.Router();
const { 
  runEmailNotifications, 
  getEmailJobStatus 
} = require('../controllers/emailController');

// Test route
router.get('/test', (req, res) => {
  res.json({
    status: 'success',
    message: 'Email routes working!',
    timestamp: new Date().toISOString()
  });
});

/**
 * Manual trigger for email notifications (for testing)
 * POST /api/email/trigger-notifications
 */
router.post('/trigger-notifications', runEmailNotifications);

/**
 * Get email notification job status
 * GET /api/email/job-status
 */
router.get('/job-status', getEmailJobStatus);

module.exports = router;