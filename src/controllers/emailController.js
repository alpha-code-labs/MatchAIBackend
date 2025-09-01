const EmailNotificationJob = require('../jobs/emailNotificationJob');

const emailNotificationJob = new EmailNotificationJob();

/**
 * Manually trigger email notification job (for testing)
 */
const runEmailNotifications = async (req, res) => {
  try {
    const result = await emailNotificationJob.runManually();
    
    res.status(200).json({
      status: 'success',
      message: 'Email notification job completed successfully',
      data: result
    });

  } catch (error) {
    console.error('❌ Manual email notification job failed:', error);
    
    res.status(500).json({
      status: 'error',
      message: 'Email notification job failed',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

/**
 * Get email notification job status
 */
const getEmailJobStatus = (req, res) => {
  try {
    const status = emailNotificationJob.getStatus();
    
    res.status(200).json({
      status: 'success',
      message: 'Email notification job status',
      data: status
    });

  } catch (error) {
    console.error('❌ Error getting email job status:', error);
    
    res.status(500).json({
      status: 'error',
      message: 'Failed to get email job status',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

module.exports = {
  runEmailNotifications,
  getEmailJobStatus,
  emailNotificationJob // Export the job instance for starting in server.js
};