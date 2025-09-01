const cron = require('node-cron');
const { db } = require('../config/firebase');
const EmailNotificationService = require('../services/emailNotificationService');

class EmailNotificationJob {
  constructor() {
    this.emailService = new EmailNotificationService();
    this.isRunning = false;
    this.lastRun = null;
    this.nextRun = null;
  }

  /**
   * Start the cron job - runs daily at 7:00 AM IST
   */
  start() {
    console.log('📧 Email notification cron job started');
    console.log('⏰ Scheduled to run daily at 7:00 AM IST (1:30 AM UTC)');

    // Cron expression: "30 1 * * *" = 1:30 AM UTC = 7:00 AM IST
    this.cronJob = cron.schedule('30 1 * * *', async () => {
      await this.run();
    }, {
      scheduled: true,
      timezone: "UTC"
    });

    this.updateNextRunTime();
  }

  /**
   * Stop the cron job
   */
  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      console.log('📧 Email notification cron job stopped');
    }
  }

  /**
   * Main job execution
   */
  async run() {
    if (this.isRunning) {
      console.log('⚠️ Email notification job already running, skipping...');
      return;
    }

    this.isRunning = true;
    this.lastRun = new Date();
    
    console.log('🚀 Starting email notification job at:', this.lastRun.toISOString());

    try {
      // ONLY process generic notifications
      const usersWithPendingNotifications = await this.getUsersWithPendingNotifications();

      let results = {
        notifications: { count: 0, success: 0, errors: 0 }
      };

      if (usersWithPendingNotifications.length > 0) {

        const notificationResult = await this.sendGenericNotifications(usersWithPendingNotifications);
        await this.updateNotificationFlags(usersWithPendingNotifications);

        results.notifications = {
          count: usersWithPendingNotifications.length,
          success: notificationResult.successCount,
          errors: notificationResult.failureCount
        };
      } 

      console.log('📈 Email notification job completed:', results);
      return results;

    } catch (error) {
      console.error('❌ Email notification job failed:', error);
      throw error;
    } finally {
      this.isRunning = false;
      this.updateNextRunTime();
    }
  }

  /**
   * Get users who have pending notifications
   */
  async getUsersWithPendingNotifications() {
    try {
      const snapshot = await db.collection('matches').get();
      const userEmailMap = new Map();

      snapshot.forEach(doc => {
        const matchData = doc.data();
        const matchId = doc.id;
        
        // Check if user1 has pending notification
        if (matchData.notification_pending_user1 && !matchData.notification_sent_user1) {
          if (!userEmailMap.has(matchData.user1_id)) {
            userEmailMap.set(matchData.user1_id, {
              matchIds: []
            });
          }
          userEmailMap.get(matchData.user1_id).matchIds.push(matchId);
        }
        
        // Check if user2 has pending notification
        if (matchData.notification_pending_user2 && !matchData.notification_sent_user2) {
          if (!userEmailMap.has(matchData.user2_id)) {
            userEmailMap.set(matchData.user2_id, {
              matchIds: []
            });
          }
          userEmailMap.get(matchData.user2_id).matchIds.push(matchId);
        }
      });

      return this.buildUserNotificationData(userEmailMap);
    } catch (error) {
      console.error('❌ Error getting users with pending notifications:', error);
      throw error;
    }
  }

  /**
   * Helper function to build user notification data
   */
  async buildUserNotificationData(userEmailMap) {
    const users = [];
    
    for (const [userId, userData] of userEmailMap) {
      try {
        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();
        
        if (userDoc.exists) {
          const userDetails = userDoc.data();
          
          users.push({
            id: userId,
            email: userDetails.email,
            firstName: userDetails.firstName,
            lastName: userDetails.lastName,
            matchIds: userData.matchIds,
            notificationCount: userData.matchIds.length
          });
        }
      } catch (error) {
        console.error(`❌ Error getting user ${userId}:`, error.message);
      }
    }
    
    return users;
  }

  /**
   * Send generic notification emails with delay
   */
  async sendGenericNotifications(users) {
    let successCount = 0;
    let failureCount = 0;
    for (const user of users) {
      try {
        const emailData = {
          user: {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName
          },
          notificationCount: user.notificationCount
        };

        await this.emailService.sendGenericNotificationEmail(emailData);
        successCount++;        
        // Add 1.5 second delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1500));
        
      } catch (error) {
        failureCount++;
        console.error(`❌ Failed to send notification to ${user.firstName} (${user.email}):`, error.message);
      }
    }

    return { successCount, failureCount };
  }

  /**
   * Update notification flags
   */
  async updateNotificationFlags(users) {
    try {
      const batch = db.batch();
      let updateCount = 0;

      for (const user of users) {
        for (const matchId of user.matchIds) {
          try {
            const matchRef = db.collection('matches').doc(matchId);
            const matchDoc = await matchRef.get();
            
            if (matchDoc.exists) {
              const matchData = matchDoc.data();
              const updateData = {};
              
              if (matchData.user1_id === user.id && matchData.notification_pending_user1) {
                updateData.notification_sent_user1 = true;
                updateData.notification_pending_user1 = false;
                updateCount++;
              } else if (matchData.user2_id === user.id && matchData.notification_pending_user2) {
                updateData.notification_sent_user2 = true;
                updateData.notification_pending_user2 = false;
                updateCount++;
              }
              
              if (Object.keys(updateData).length > 0) {
                batch.update(matchRef, updateData);
              }
            }
          } catch (error) {
            console.error(`❌ Error preparing notification flag update for match ${matchId}:`, error.message);
          }
        }
      }

      if (updateCount > 0) {
        await batch.commit();
      } 

    } catch (error) {
      console.error('❌ Error updating notification flags:', error);
    }
  }

  /**
   * Manual trigger for testing
   */
  async runManually() {
    return await this.run();
  }

  /**
   * Get job status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      lastRun: this.lastRun,
      nextRun: this.nextRun,
      cronExpression: '30 1 * * *',
      timezone: 'UTC'
    };
  }

  /**
   * Update next run time for status reporting
   */
  updateNextRunTime() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(1, 30, 0, 0);
    
    if (now.getUTCHours() > 1 || (now.getUTCHours() === 1 && now.getUTCMinutes() >= 30)) {
      this.nextRun = tomorrow;
    } else {
      const today = new Date(now);
      today.setUTCHours(1, 30, 0, 0);
      this.nextRun = today;
    }
  }
}

module.exports = EmailNotificationJob;