const cron = require('node-cron');
const MatchingService = require('../services/matchingService');
const pushNotificationService = require('../services/pushNotificationService'); // NEW: Import push notification service

class DailyMatchingJob {
  constructor() {
    this.matchingService = new MatchingService();
    this.isRunning = false;
  }

  /**
   * Start the daily matching job scheduler
   * Runs every day at 6:00 AM IST
   */
  start() {
    console.log('🕕 Starting daily matching job scheduler...');
    console.log('⏰ Job will run daily at 6:00 AM IST');

    // Cron expression: '30 0 * * *' = At 00:30 UTC every day
    // IST is UTC+5:30, so 6:00 AM IST = 00:30 UTC
    const cronExpression = '30 0 * * *'; // 00:30 UTC = 6:00 AM IST

    cron.schedule(cronExpression, async () => {
      if (this.isRunning) {
        console.log('⚠️ Previous matching job is still running, skipping this execution');
        return;
      }

      console.log('🚀 Starting daily matching job at', new Date().toLocaleString('en-IN', {timeZone: 'Asia/Kolkata'}));
      this.isRunning = true;

      try {
        const result = await this.matchingService.runDailyMatching();
        
        console.log('🎉 Daily matching job completed successfully!');

        // NEW: Send push notifications for new matches
        await this.sendMatchNotifications(result);
        
        // Log to monitoring/analytics if needed
        this.logJobCompletion(result);

      } catch (error) {
        console.error('❌ Daily matching job failed:', error);
        
        // Send alert/notification about job failure
        this.handleJobFailure(error);
      } finally {
        this.isRunning = false;
        console.log('🏁 Daily matching job finished at', new Date().toLocaleString('en-IN', {timeZone: 'Asia/Kolkata'}));
      }
    }, {
      scheduled: true,
      timezone: "UTC" // We handle IST conversion in cron expression
    });

    console.log('✅ Daily matching job scheduler started successfully');
  }

  /**
   * Stop the scheduler (for graceful shutdown)
   */
  stop() {
    console.log('🛑 Stopping daily matching job scheduler...');
    // Note: node-cron doesn't have a direct stop method for individual jobs
    // In production, you'd typically handle this with process management
  }

  /**
   * Run matching job manually (for testing)
   */
  async runManually() {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    try {
      const result = await this.matchingService.runDailyMatching();

      // NEW: Send push notifications for manual matches too
      await this.sendMatchNotifications(result);

      return result;
    } catch (error) {
      console.error('❌ Manual matching job failed:', error);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * NEW: Send push notifications for new matches
   * @param {object} matchingResult - Result from matching service
   */
  async sendMatchNotifications(matchingResult) {
    try {
      console.log('🔔 Starting push notification process...');

      // Check if push notification service is available
      const pushServiceStatus = pushNotificationService.getStatus();
      if (!pushServiceStatus.isInitialized) {
        console.warn('⚠️ Push notification service not initialized, skipping notifications');
        return;
      }

      // Extract user notifications from matching result
      const userNotifications = this.extractUserNotifications(matchingResult);

      if (!userNotifications || userNotifications.length === 0) {
        console.log('📭 No users to notify about new matches');
        return;
      }

      let notificationStats = {
        total: userNotifications.length,
        successful: 0,
        failed: 0
      };

      // Send notifications for each user with new matches
      for (const userNotification of userNotifications) {
        try {
          const result = await pushNotificationService.sendMatchNotification(
            userNotification.userId,
            userNotification.matchData
          );

          if (result.success) {
            notificationStats.successful++;
          } else {
            notificationStats.failed++;
          }

        } catch (error) {
          notificationStats.failed++;
          console.error(`❌ Error sending notification to user ${userNotification.userId}:`, error);
        }
      }

    } catch (error) {
      console.error('❌ Failed to send push notifications:', error);
      // Don't throw error here - push notification failure shouldn't fail the entire matching job
    }
  }

  /**
   * NEW: Extract user notifications from matching result
   * @param {object} matchingResult - Result from matching service
   * @returns {Array} Array of user notifications
   */
  extractUserNotifications(matchingResult) {
    try {
      const userNotifications = [];

      // Check if matching result has the expected structure
      if (!matchingResult || !matchingResult.newMatches) {
        return userNotifications;
      }

      // Group matches by user to count notifications
      const userMatchCounts = {};

      matchingResult.newMatches.forEach(match => {
        // Count matches for user1
        if (!userMatchCounts[match.user1_id]) {
          userMatchCounts[match.user1_id] = {
            totalCount: 0,
            mutualCount: 0,
            oneWayCount: 0
          };
        }

        // Count matches for user2
        if (!userMatchCounts[match.user2_id]) {
          userMatchCounts[match.user2_id] = {
            totalCount: 0,
            mutualCount: 0,
            oneWayCount: 0
          };
        }

        // Update counts based on match type
        if (match.match_type === 'mutual_algorithm') {
          userMatchCounts[match.user1_id].mutualCount++;
          userMatchCounts[match.user1_id].totalCount++;
          userMatchCounts[match.user2_id].mutualCount++;
          userMatchCounts[match.user2_id].totalCount++;
        } 
        // else if (match.match_type === 'one_way_interest') {
        //   // One-way interest: user1 is interested in user2
        //   userMatchCounts[match.user2_id].oneWayCount++;
        //   userMatchCounts[match.user2_id].totalCount++;
        // }
      });

      // Create notification objects for users with matches
      Object.keys(userMatchCounts).forEach(userId => {
        const matchData = userMatchCounts[userId];
        
        // Only notify if user has at least one match
        if (matchData.totalCount > 0) {
          userNotifications.push({
            userId: userId,
            matchData: matchData
          });
        }
      });

      return userNotifications;

    } catch (error) {
      console.error('❌ Error extracting user notifications:', error);
      return [];
    }
  }

  /**
   * Log job completion for monitoring
   */
  logJobCompletion(result) {
    // You can integrate with logging services like Winston, or analytics
    // TODO: Send to monitoring service (DataDog, CloudWatch, etc.)
    // TODO: Update job status in database
  }

  /**
   * Handle job failure
   */
  handleJobFailure(error) {
    console.error('🚨 Job Failure Details:', {
      timestamp: new Date().toISOString(),
      error: error.message,
      stack: error.stack,
      success: false
    });

    // TODO: Send alert email/slack notification
    // TODO: Log to error tracking service (Sentry, Bugsnag, etc.)
    // TODO: Update job status in database
  }

  /**
   * Get job status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      nextRun: this.getNextRunTime(),
      timezone: 'IST (UTC+5:30)',
      cronExpression: '30 0 * * *', // 6:00 AM IST daily
      pushNotificationService: pushNotificationService.getStatus() // NEW: Include push service status
    };
  }

  /**
   * Calculate next run time
   */
  getNextRunTime() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(6, 0, 0, 0); // 6:00 AM IST tomorrow
    
    return tomorrow.toLocaleString('en-IN', {timeZone: 'Asia/Kolkata'});
  }
}

module.exports = DailyMatchingJob;