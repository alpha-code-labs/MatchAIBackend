const express = require('express');
const router = express.Router();
const {
  createOrGetConversation,
  getConversations,
  getMessages,
  sendMessage,
  markMessagesAsRead,
  deleteConversation,
  blockUser
} = require('../controllers/chatController');

// Create or get conversation
router.post('/conversation', createOrGetConversation);

// Get conversations for a user
router.get('/conversations/:userId', getConversations);

// Get messages for a conversation
router.get('/messages/:chatId', getMessages);

// Send a message
router.post('/send', sendMessage);

// Mark messages as read
router.post('/mark-read', markMessagesAsRead);

// Delete conversation
router.post('/delete-conversation', deleteConversation);

// NEW: Block user
router.post('/block-user', blockUser);

module.exports = router;