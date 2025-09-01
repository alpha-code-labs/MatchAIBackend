const express = require('express');
const router = express.Router();
const { uploadFields, handleUploadError } = require('../middleware/upload');
const {
  signInUser,
  registerUser,
  updateUserProfile,
  updateMatchSettings,
  updateQuestions,
  updateBio,
  verifyEmailToken,
  updatePWAStatus,  // PWA status update function
  updateTourStatus  // ✅ ADD: Tour status update function
} = require('../controllers/userController');

// Test route
router.get('/test', (req, res) => {
  res.json({
    status: 'success',
    message: 'User routes working!',
    timestamp: new Date().toISOString()
  });
});

// User sign in route
router.post('/signin', signInUser);

// Email token verification route (For auto-login)
router.post('/verify-email-token', verifyEmailToken);

// User registration route
router.post('/register', uploadFields, handleUploadError, registerUser);

// User profile update route
router.put('/profile', uploadFields, handleUploadError, updateUserProfile);

// User match settings update route
router.put('/match-settings', updateMatchSettings);

// User questions update route
router.put('/questions', updateQuestions);

// User bio update route
router.put('/update-bio', updateBio);

// PWA status update route
router.put('/pwa-status', updatePWAStatus);

// ✅ NEW: Tour status update route
router.patch('/tour-status', updateTourStatus);

module.exports = router;