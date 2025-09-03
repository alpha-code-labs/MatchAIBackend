const { Resend } = require('resend');
const jwt = require('jsonwebtoken');
const webpush = require('web-push');

class EmailNotificationService {
  constructor() {
    this.resend = new Resend(process.env.RESEND_API_KEY);
    
    // Configure web-push with VAPID keys
    webpush.setVapidDetails(
      'mailto:' + process.env.VAPID_EMAIL,
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );
  }

  /**
   * Generate auto-login token for email links
   */
  generateAutoLoginToken(userId, email) {
    try {
      const token = jwt.sign(
        { 
          userId: userId, 
          email: email,
          purpose: 'email_login',
          exp: Math.floor(Date.now() / 1000) + (48 * 60 * 60) // 48 hours
        }, 
        process.env.JWT_SECRET
      );
      
      return token;
    } catch (error) {
      console.error('❌ Error generating auto-login token:', error);
      throw error;
    }
  }

  /**
   * Generate dashboard URL with auto-login token
   */
  generateDashboardLink(userId, email) {
    const token = this.generateAutoLoginToken(userId, email);
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    return `${baseUrl}/auto-login?token=${token}&redirect=dashboard`;
  }

  /**
   * Send push notification
   */
  async sendPushNotification(subscription, payload) {
    try {
      if (!subscription) {
        console.log('No push subscription available');
        return null;
      }

      const result = await webpush.sendNotification(subscription, JSON.stringify(payload));
      console.log('✅ Push notification sent successfully');
      return result;
    } catch (error) {
      console.error('❌ Error sending push notification:', error);
      
      // Handle expired subscriptions
      if (error.statusCode === 410) {
        console.log('Push subscription has expired or is invalid');
        // Could trigger subscription removal from database here
        return null;
      }
      
      throw error;
    }
  }

  /**
   * Send match push notification
   */
  async sendMatchPushNotification(user, matchCount) {
    try {
      if (!user.pushSubscription) {
        return null;
      }

      const payload = {
        title: 'Match.AI - New Matches! 💕',
        body: `You have ${matchCount} new match${matchCount > 1 ? 'es' : ''} waiting for you!`,
        icon: '/icon-192x192.png',
        badge: '/icon-192x192.png',
        data: {
          url: '/dashboard#matches',
          type: 'match_notification'
        }
      };

      return await this.sendPushNotification(user.pushSubscription, payload);
    } catch (error) {
      console.error('❌ Error sending match push notification:', error);
      return null;
    }
  }

  /**
   * Send message push notification
   */
  async sendMessagePushNotification(user, senderName, messagePreview) {
    try {
      if (!user.pushSubscription) {
        return null;
      }

      const payload = {
        title: `New message from ${senderName} 💬`,
        body: messagePreview || 'You have a new message',
        icon: '/icon-192x192.png',
        badge: '/icon-192x192.png',
        data: {
          url: '/dashboard#messages',
          type: 'message_notification'
        }
      };

      return await this.sendPushNotification(user.pushSubscription, payload);
    } catch (error) {
      console.error('❌ Error sending message push notification:', error);
      return null;
    }
  }

  /**
   * Send generic notification email (with push notification)
   */
  async sendGenericNotificationEmail(emailData) {
    try {

      const dashboardLink = this.generateDashboardLink(emailData.user.id, emailData.user.email);

      // Send email
      const resendEmailData = {
        from: 'notifications@notifications.alphacodelabs.com',
        to: emailData.user.email,
        subject: 'You have new activity on Match.AI!',
        html: this.generateGenericEmailTemplate(emailData, dashboardLink)
      };

      const emailResult = await this.resend.emails.send(resendEmailData);
      
      if (!emailResult.data?.id) {
        throw new Error('Email send failed - no result ID returned');
      }

      // Also send push notification if user has subscription
      if (emailData.user.pushSubscription && emailData.user.pushNotificationsEnabled) {
        await this.sendMatchPushNotification(emailData.user, emailData.notificationCount);
      }
      
      return emailResult;

    } catch (error) {
      console.error('❌ Error sending generic notification email:', error);
      throw error;
    }
  }

  /**
   * Send message notification (instant push + optional email)
   */
  async sendMessageNotification(recipientUser, senderName, messagePreview, sendEmail = false) {
    try {
      const results = {
        push: null,
        email: null
      };

      // Send push notification immediately if enabled
      if (recipientUser.pushSubscription && recipientUser.pushNotificationsEnabled) {
        results.push = await this.sendMessagePushNotification(
          recipientUser, 
          senderName, 
          messagePreview
        );
      }

      // Send email if requested
      if (sendEmail) {
        const emailData = {
          user: recipientUser,
          notificationCount: 1
        };
        results.email = await this.sendGenericNotificationEmail(emailData);
      }

      return results;
    } catch (error) {
      console.error('❌ Error sending message notification:', error);
      throw error;
    }
  }

  /**
   * Generate generic notification email template
   */
  generateGenericEmailTemplate(emailData, dashboardLink) {
    const { user, notificationCount } = emailData;
    
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>New Activity on Match.AI!</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc;">
        <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.07);">
          
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); padding: 40px 30px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 32px; font-weight: bold; letter-spacing: 1px;">
              Match.AI
            </h1>
            <p style="color: rgba(255, 255, 255, 0.9); margin: 10px 0 0 0; font-size: 16px;">
              You have new activity!
            </p>
          </div>

          <!-- Main Content -->
          <div style="padding: 40px 30px; background-color: #ffffff;">
            
            <!-- Personal Greeting -->
            <div style="text-align: center; margin-bottom: 40px;">
              <div style="font-size: 50px; margin-bottom: 15px;">🔔</div>
              <h2 style="color: #1f2937; margin: 0; font-size: 28px; font-weight: 700;">
                Hey ${user.firstName}!
              </h2>
              <p style="color: #6b7280; margin: 10px 0 0 0; font-size: 18px;">
                You have ${notificationCount} new notification${notificationCount > 1 ? 's' : ''} waiting for you!
              </p>
            </div>

            <!-- Activity Summary -->
            <div style="background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%); border-radius: 16px; padding: 25px; margin-bottom: 30px; text-align: center;">
              <div style="font-size: 32px; font-weight: bold; color: #0369a1; margin-bottom: 5px;">
                ${notificationCount}
              </div>
              <div style="color: #0284c7; font-size: 16px; font-weight: 600;">
                New Activity
              </div>
              <div style="color: #0284c7; font-size: 14px; margin-top: 8px;">
                Check your matches to see what's new!
              </div>
            </div>

            <!-- Call to Action Button -->
            <div style="text-align: center; margin: 40px 0;">
              <a href="${dashboardLink}" 
                 style="display: inline-block; background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); 
                        color: #ffffff; padding: 18px 45px; text-decoration: none; 
                        border-radius: 50px; font-weight: 700; font-size: 18px; 
                        box-shadow: 0 10px 25px rgba(59, 130, 246, 0.3);
                        transition: all 0.3s ease;">
                Check Your Activity
              </a>
            </div>

            <!-- Footer Message -->
            <div style="text-align: center; margin-top: 40px; padding-top: 30px; border-top: 1px solid #e5e7eb;">
              <p style="color: #9ca3af; margin: 0; font-size: 14px; line-height: 1.5;">
                This link will expire in 48 hours for your security.<br>
                Don't miss out on potential connections!
              </p>
              <p style="color: #6b7280; margin: 15px 0 0 0; font-size: 16px; font-weight: 600;">
                The Match.AI Team
              </p>
            </div>
          </div>

          <!-- Footer -->
          <div style="background-color: #f9fafb; padding: 30px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="color: #9ca3af; margin: 0; font-size: 12px;">
              © 2025 Match.AI. All rights reserved.<br>
              You received this email because you have new activity on your account.
            </p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Utility function to add delay
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = EmailNotificationService;
