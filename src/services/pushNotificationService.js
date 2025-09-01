const webpush = require('web-push');
const { db } = require('../config/firebase');

class PushNotificationService {
  constructor() {
    this.isInitialized = false;
    this.initialize();
  }

  /**
   * Initialize VAPID configuration
   */
  initialize() {
    try {
      const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
      const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

      if (!vapidPublicKey || !vapidPrivateKey) {
        console.error('❌ VAPID keys not found in environment variables');
        return;
      }

      // Set VAPID details for web-push
      webpush.setVapidDetails(
        'mailto:support@matchai.com', // Replace with your contact email
        vapidPublicKey,
        vapidPrivateKey
      );

      this.isInitialized = true;
    } catch (error) {
      console.error('❌ Failed to initialize push notification service:', error);
      this.isInitialized = false;
    }
  }

  /**
   * Send push notification to a single user
   * @param {string} userId - User ID to send notification to
   * @param {object} notificationData - Notification payload
   */
  async sendNotificationToUser(userId, notificationData) {
    if (!this.isInitialized) {
      console.error('❌ Push notification service not initialized');
      return { success: false, error: 'Service not initialized' };
    }

    try {
      // Get user's push subscription from database
      const userRef = db.collection('users').doc(userId);
      const userDoc = await userRef.get();

      if (!userDoc.exists) {
        console.error(`❌ User not found: ${userId}`);
        return { success: false, error: 'User not found' };
      }

      const userData = userDoc.data();

      // Check if user has push notifications enabled and subscription
      if (!userData.pushNotificationsEnabled || !userData.pushSubscription) {
        return { success: false, error: 'Push notifications not enabled or subscription missing' };
      }

      // Prepare notification payload
      const payload = JSON.stringify({
        title: notificationData.title || 'Match.AI',
        body: notificationData.body || 'You have new matches!',
        icon: notificationData.icon || '/logo192.png',
        badge: notificationData.badge || '/logo192.png',
        tag: notificationData.tag || 'match-notification',
        data: {
          url: notificationData.url || '/',
          type: notificationData.type || 'match',
          ...notificationData.data
        },
        actions: notificationData.actions || [
          {
            action: 'view',
            title: 'View Matches'
          },
          {
            action: 'dismiss',
            title: 'Dismiss'
          }
        ]
      });

      // Send the notification
      const result = await webpush.sendNotification(userData.pushSubscription, payload);

      return { 
        success: true, 
        statusCode: result.statusCode,
        userId: userId 
      };

    } catch (error) {
      console.error(`❌ Failed to send push notification to user ${userId}:`, error);

      // Handle specific push errors
      if (error.statusCode === 410 || error.statusCode === 404) {
        // Subscription is no longer valid - clean it up
        await this.cleanupInvalidSubscription(userId);
        return { success: false, error: 'Subscription invalid and cleaned up' };
      }

      return { 
        success: false, 
        error: error.message,
        statusCode: error.statusCode 
      };
    }
  }

  /**
   * Send push notifications to multiple users
   * @param {Array} userIds - Array of user IDs
   * @param {object} notificationData - Notification payload
   */
  async sendNotificationToMultipleUsers(userIds, notificationData) {
    if (!this.isInitialized) {
      console.error('❌ Push notification service not initialized');
      return { success: false, error: 'Service not initialized' };
    }

    const results = {
      successful: [],
      failed: [],
      total: userIds.length
    };

    // Send notifications with concurrency limit
    const BATCH_SIZE = 10; // Process 10 notifications at a time
    for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
      const batch = userIds.slice(i, i + BATCH_SIZE);
      
      const batchPromises = batch.map(async (userId) => {
        const result = await this.sendNotificationToUser(userId, notificationData);
        
        if (result.success) {
          results.successful.push(userId);
        } else {
          results.failed.push({ userId, error: result.error });
        }
        
        return result;
      });

      // Wait for current batch to complete before starting next batch
      await Promise.all(batchPromises);
      
    }


    return {
      success: true,
      results: results
    };
  }

  /**
   * Send match notification to a user
   * @param {string} userId - User ID
   * @param {object} matchData - Match information
   */
  async sendMatchNotification(userId, matchData) {
    const { totalCount, mutualCount, oneWayCount } = matchData;
    
    let title = 'Match.AI';
    let body = `You have ${totalCount} new match${totalCount > 1 ? 'es' : ''}!`;
    
    // Customize message based on match types
    if (mutualCount > 0 && oneWayCount > 0) {
      body = `You have ${mutualCount} mutual match${mutualCount > 1 ? 'es' : ''} and ${oneWayCount} person${oneWayCount > 1 ? 's' : ''} interested in you!`;
    } else if (mutualCount > 0) {
      body = `You have ${mutualCount} new mutual match${mutualCount > 1 ? 'es' : ''}!`;
    } else if (oneWayCount > 0) {
      body = `${oneWayCount} person${oneWayCount > 1 ? 's are' : ' is'} interested in you!`;
    }

    const notificationData = {
      title: title,
      body: body,
      icon: '/logo192.png',
      badge: '/logo192.png',
      tag: 'match-notification',
      url: '/#/matches',
      type: 'match',
      data: {
        matchCount: totalCount,
        mutualCount: mutualCount,
        oneWayCount: oneWayCount
      }
    };

    return await this.sendNotificationToUser(userId, notificationData);
  }

  /**
   * Clean up invalid push subscription
   * @param {string} userId - User ID with invalid subscription
   */
  async cleanupInvalidSubscription(userId) {
    try {
      const userRef = db.collection('users').doc(userId);
      await userRef.update({
        pushSubscription: null,
        pushNotificationsEnabled: false,
        notificationPermissionDenied: true,
        updatedAt: new Date()
      });
    } catch (error) {
      console.error(`❌ Failed to cleanup subscription for user ${userId}:`, error);
    }
  }

  /**
   * Test notification - useful for debugging
   * @param {string} userId - User ID to send test notification to
   */
  async sendTestNotification(userId) {
    const testData = {
      title: 'Match.AI Test',
      body: 'This is a test notification to verify push notifications are working!',
      icon: '/logo192.png',
      tag: 'test-notification',
      type: 'test'
    };

    return await this.sendNotificationToUser(userId, testData);
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      isInitialized: this.isInitialized,
      hasVapidKeys: !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
    };
  }
}

// Export singleton instance
module.exports = new PushNotificationService();