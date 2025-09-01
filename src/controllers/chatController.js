const { realtimeDb, db } = require('../config/firebase');

// Helper function to generate chat ID from two user IDs
const generateChatId = (userId1, userId2) => {
  return [userId1, userId2].sort().join('_');
};

// Helper function to get user basic info
const getUserBasicInfo = async (userId) => {
  try {
    const userDoc = await db.collection('users').doc(userId).get();
    if (userDoc.exists) {
      const userData = userDoc.data();
      return {
        id: userId,
        firstName: userData.firstName,
        lastName: userData.lastName,
        profilePicture: userData.profilePicture
      };
    }
    return null;
  } catch (error) {
    console.error('Error getting user info:', error);
    return null;
  }
};

// Create or get existing conversation
const createOrGetConversation = async (req, res) => {
  try {
    const { user1Id, user2Id } = req.body;

    if (!user1Id || !user2Id) {
      return res.status(400).json({
        status: 'error',
        message: 'Both user IDs are required'
      });
    }

    if (user1Id === user2Id) {
      return res.status(400).json({
        status: 'error',
        message: 'Cannot create conversation with yourself'
      });
    }

    const chatId = generateChatId(user1Id, user2Id);
    
    // Check if conversation already exists
    const conversationRef = realtimeDb.ref(`conversations/${chatId}`);
    const conversationSnapshot = await conversationRef.once('value');
    
    if (conversationSnapshot.exists()) {
      // Conversation exists, ensure it's in user indexes
      const conversationData = conversationSnapshot.val();
      
      // Add to user indexes if not already there
      const updates = {};
      updates[`userConversations/${user1Id}/${chatId}`] = true;
      updates[`userConversations/${user2Id}/${chatId}`] = true;
      await realtimeDb.ref().update(updates);
      
      res.json({
        status: 'success',
        data: {
          chatId,
          conversation: conversationData
        }
      });
    } else {
      // Create new conversation
      const user1Info = await getUserBasicInfo(user1Id);
      const user2Info = await getUserBasicInfo(user2Id);
      
      if (!user1Info || !user2Info) {
        return res.status(404).json({
          status: 'error',
          message: 'One or both users not found'
        });
      }

      const newConversation = {
        participants: {
          [user1Id]: {
            ...user1Info,
            lastSeen: new Date().toISOString(),
            unreadCount: 0
          },
          [user2Id]: {
            ...user2Info,
            lastSeen: new Date().toISOString(),
            unreadCount: 0
          }
        },
        createdAt: new Date().toISOString(),
        lastMessage: null,
        lastMessageAt: null,
        deletedBy: []
      };

      await conversationRef.set(newConversation);
      
      // Add to user indexes
      const updates = {};
      updates[`userConversations/${user1Id}/${chatId}`] = true;
      updates[`userConversations/${user2Id}/${chatId}`] = true;
      await realtimeDb.ref().update(updates);

      res.json({
        status: 'success',
        data: {
          chatId,
          conversation: newConversation
        }
      });
    }

  } catch (error) {
    console.error('Error creating/getting conversation:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to create/get conversation'
    });
  }
};

// Get all conversations for a user (excluding deleted ones)
const getConversations = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        status: 'error',
        message: 'User ID is required'
      });
    }

    const conversations = [];
    
    // First try to get from user index
    const userConversationsRef = realtimeDb.ref(`userConversations/${userId}`);
    const userConvSnapshot = await userConversationsRef.once('value');
    
    if (userConvSnapshot.exists()) {
      // Use the index method
      const chatIds = Object.keys(userConvSnapshot.val());
      
      for (const chatId of chatIds) {
        const conversationRef = realtimeDb.ref(`conversations/${chatId}`);
        const convSnapshot = await conversationRef.once('value');
        
        if (convSnapshot.exists()) {
          const conversation = convSnapshot.val();
          
          // Skip conversations that user has deleted
          const deletedBy = conversation.deletedBy || [];
          if (deletedBy.includes(userId)) {
            continue;
          }

          // Get the other participant
          const otherUserId = Object.keys(conversation.participants).find(id => id !== userId);
          const otherUser = conversation.participants[otherUserId];
          
          conversations.push({
            chatId,
            otherUser,
            lastMessage: conversation.lastMessage,
            lastMessageAt: conversation.lastMessageAt,
            unreadCount: conversation.participants[userId]?.unreadCount || 0,
            createdAt: conversation.createdAt
          });
        }
      }
    } else {
      // Fallback to old method for existing data
      const conversationsRef = realtimeDb.ref('conversations');
      const snapshot = await conversationsRef.once('value');
      
      if (snapshot.exists()) {
        const conversationsData = snapshot.val();
        
        for (const [chatId, conversation] of Object.entries(conversationsData)) {
          // Check if user is a participant
          if (!conversation.participants || !conversation.participants[userId]) {
            continue;
          }
          
          // Skip conversations that user has deleted
          const deletedBy = conversation.deletedBy || [];
          if (deletedBy.includes(userId)) {
            continue;
          }

          // Get the other participant
          const otherUserId = Object.keys(conversation.participants).find(id => id !== userId);
          const otherUser = conversation.participants[otherUserId];
          
          conversations.push({
            chatId,
            otherUser,
            lastMessage: conversation.lastMessage,
            lastMessageAt: conversation.lastMessageAt,
            unreadCount: conversation.participants[userId]?.unreadCount || 0,
            createdAt: conversation.createdAt
          });
          
          // Add to user index for future queries
          await realtimeDb.ref(`userConversations/${userId}/${chatId}`).set(true);
        }
      }
    }

    // Sort by last message time (newest first)
    conversations.sort((a, b) => {
      const timeA = a.lastMessageAt ? new Date(a.lastMessageAt) : new Date(a.createdAt);
      const timeB = b.lastMessageAt ? new Date(b.lastMessageAt) : new Date(b.createdAt);
      return timeB - timeA;
    });

    res.json({
      status: 'success',
      data: {
        conversations,
        totalUnread: conversations.reduce((sum, conv) => sum + conv.unreadCount, 0)
      }
    });

  } catch (error) {
    console.error('Error getting conversations:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get conversations'
    });
  }
};

// Get messages for a conversation
const getMessages = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { limit = 50, before } = req.query;

    if (!chatId) {
      return res.status(400).json({
        status: 'error',
        message: 'Chat ID is required'
      });
    }

    let messagesRef = realtimeDb.ref(`messages/${chatId}`);
    
    if (before) {
      messagesRef = messagesRef.orderByChild('timestamp').endBefore(before);
    } else {
      messagesRef = messagesRef.orderByChild('timestamp');
    }
    
    messagesRef = messagesRef.limitToLast(parseInt(limit));
    
    const snapshot = await messagesRef.once('value');
    const messages = [];
    
    if (snapshot.exists()) {
      const messagesData = snapshot.val();
      
      for (const [messageId, message] of Object.entries(messagesData)) {
        messages.push({
          id: messageId,
          ...message
        });
      }
    }

    // Sort messages by timestamp (oldest first for display)
    messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    res.json({
      status: 'success',
      data: {
        messages,
        hasMore: messages.length === parseInt(limit)
      }
    });

  } catch (error) {
    console.error('Error getting messages:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get messages'
    });
  }
};

// Send a message
const sendMessage = async (req, res) => {
  try {
    const { chatId, senderId, message, messageType = 'text' } = req.body;

    if (!chatId || !senderId || !message) {
      return res.status(400).json({
        status: 'error',
        message: 'Chat ID, sender ID, and message are required'
      });
    }

    // Get conversation to find recipient
    const conversationRef = realtimeDb.ref(`conversations/${chatId}`);
    const conversationSnapshot = await conversationRef.once('value');
    
    if (!conversationSnapshot.exists()) {
      return res.status(404).json({
        status: 'error',
        message: 'Conversation not found'
      });
    }

    const conversation = conversationSnapshot.val();
    const participants = Object.keys(conversation.participants);
    const recipientId = participants.find(id => id !== senderId);

    if (!recipientId) {
      return res.status(400).json({
        status: 'error',
        message: 'Recipient not found'
      });
    }

    // Create message object
    const newMessage = {
      senderId,
      recipientId,
      message,
      messageType,
      timestamp: new Date().toISOString(),
      read: false
    };

    // Add message to messages collection
    const messagesRef = realtimeDb.ref(`messages/${chatId}`);
    const messageRef = await messagesRef.push(newMessage);
    const messageId = messageRef.key;

    // Update conversation
    const conversationUpdates = {
      lastMessage: message,
      lastMessageAt: newMessage.timestamp,
      [`participants/${recipientId}/unreadCount`]: (conversation.participants[recipientId]?.unreadCount || 0) + 1,
      deletedBy: [] // Clear the deletedBy array to restore conversation for both users
    };

    await conversationRef.update(conversationUpdates);
    
    // Ensure conversation is in both users' indexes
    const indexUpdates = {};
    indexUpdates[`userConversations/${senderId}/${chatId}`] = true;
    indexUpdates[`userConversations/${recipientId}/${chatId}`] = true;
    await realtimeDb.ref().update(indexUpdates);

    res.json({
      status: 'success',
      data: {
        messageId,
        message: {
          id: messageId,
          ...newMessage
        }
      }
    });

  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to send message'
    });
  }
};

// Mark messages as read
const markMessagesAsRead = async (req, res) => {
  try {
    const { chatId, userId } = req.body;

    if (!chatId || !userId) {
      return res.status(400).json({
        status: 'error',
        message: 'Chat ID and user ID are required'
      });
    }

    // Get all unread messages for this user in this chat
    const messagesRef = realtimeDb.ref(`messages/${chatId}`);
    const unreadMessagesQuery = messagesRef
      .orderByChild('recipientId')
      .equalTo(userId);
    
    const snapshot = await unreadMessagesQuery.once('value');
    
    if (snapshot.exists()) {
      const updates = {};
      const messagesData = snapshot.val();
      
      for (const [messageId, message] of Object.entries(messagesData)) {
        if (!message.read) {
          updates[`messages/${chatId}/${messageId}/read`] = true;
        }
      }

      // Reset unread count for user in conversation
      updates[`conversations/${chatId}/participants/${userId}/unreadCount`] = 0;
      updates[`conversations/${chatId}/participants/${userId}/lastSeen`] = new Date().toISOString();

      await realtimeDb.ref().update(updates);
    }

    res.json({
      status: 'success',
      message: 'Messages marked as read'
    });

  } catch (error) {
    console.error('Error marking messages as read:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to mark messages as read'
    });
  }
};

// Delete conversation for a specific user
const deleteConversation = async (req, res) => {
  try {
    const { chatId, userId } = req.body;

    if (!chatId || !userId) {
      return res.status(400).json({
        status: 'error',
        message: 'Chat ID and user ID are required'
      });
    }

    // Get conversation
    const conversationRef = realtimeDb.ref(`conversations/${chatId}`);
    const conversationSnapshot = await conversationRef.once('value');
    
    if (!conversationSnapshot.exists()) {
      return res.status(404).json({
        status: 'error',
        message: 'Conversation not found'
      });
    }

    const conversation = conversationSnapshot.val();
    
    // Check if user is participant
    if (!conversation.participants[userId]) {
      return res.status(403).json({
        status: 'error',
        message: 'User is not a participant in this conversation'
      });
    }

    // Add user to deletedBy array
    const deletedBy = conversation.deletedBy || [];
    if (!deletedBy.includes(userId)) {
      deletedBy.push(userId);
      
      await conversationRef.update({
        deletedBy: deletedBy,
        [`participants/${userId}/unreadCount`]: 0 // Clear unread count when deleting
      });
      
      // Remove from user's index
      await realtimeDb.ref(`userConversations/${userId}/${chatId}`).remove();
    }

    res.json({
      status: 'success',
      message: 'Conversation deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting conversation:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to delete conversation'
    });
  }
};

// Block user and remove all traces
const blockUser = async (req, res) => {
  try {
    const { chatId, userId } = req.body;

    if (!chatId || !userId) {
      return res.status(400).json({
        status: 'error',
        message: 'Chat ID and user ID are required'
      });
    }
    
    // Get conversation to find the other user
    const conversationRef = realtimeDb.ref(`conversations/${chatId}`);
    const conversationSnapshot = await conversationRef.once('value');
    
    if (!conversationSnapshot.exists()) {
      return res.status(404).json({
        status: 'error',
        message: 'Conversation not found'
      });
    }

    const conversation = conversationSnapshot.val();
    
    // Check if user is participant
    if (!conversation.participants[userId]) {
      return res.status(403).json({
        status: 'error',
        message: 'User is not a participant in this conversation'
      });
    }

    // Get the other user ID
    const otherUserId = Object.keys(conversation.participants).find(id => id !== userId);
    
    if (!otherUserId) {
      return res.status(400).json({
        status: 'error',
        message: 'Could not find other participant'
      });
    }
    
    // Step 1: Remove love matches between the two users
    const matchesSnapshot = await db.collection('matches').get();
    
    const matchesToDelete = [];
    matchesSnapshot.docs.forEach(doc => {
      const matchData = doc.data();
      
      // Check if this match involves both users and is a love match
      const involvesUsers = (
        (matchData.user1_id === userId && matchData.user2_id === otherUserId) ||
        (matchData.user1_id === otherUserId && matchData.user2_id === userId)
      );
      
      // Only delete love matches (chat_unlocked = true)
      if (involvesUsers && matchData.chat_unlocked) {
        matchesToDelete.push(doc.id);
      }
    });

    // Delete the love matches
    if (matchesToDelete.length > 0) {
      const batch = db.batch();
      matchesToDelete.forEach(matchId => {
        const matchRef = db.collection('matches').doc(matchId);
        batch.delete(matchRef);
      });
      await batch.commit();
    }

    // Step 2: Delete all messages for this conversation
    const messagesRef = realtimeDb.ref(`messages/${chatId}`);
    await messagesRef.remove();

    // Step 3: Delete the conversation completely
    await conversationRef.remove();
    
    // Step 4: Remove from both users' indexes
    await realtimeDb.ref(`userConversations/${userId}/${chatId}`).remove();
    await realtimeDb.ref(`userConversations/${otherUserId}/${chatId}`).remove();

    res.json({
      status: 'success',
      message: 'User blocked successfully',
      data: {
        matchesDeleted: matchesToDelete.length,
        conversationDeleted: true,
        messagesDeleted: true
      }
    });

  } catch (error) {
    console.error('Error blocking user:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to block user',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

module.exports = {
  createOrGetConversation,
  getConversations,
  getMessages,
  sendMessage,
  markMessagesAsRead,
  deleteConversation,
  blockUser
};