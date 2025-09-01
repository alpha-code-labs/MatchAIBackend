const express = require('express');
const router = express.Router();
const {
  expressInterest,
  acceptInterest,
  likeMatch,
  passMatch,
  getMatchDetails
} = require('../controllers/matchingController');

// Test route
router.get('/test', (req, res) => {
  res.json({
    status: 'success',
    message: 'Matching routes working!',
    timestamp: new Date().toISOString()
  });
});

/**
 * Express interest in a one-way match
 * POST /api/matching/express-interest
 * Body: { matchId, userId }
 */
router.post('/express-interest', expressInterest);

/**
 * Accept interest from a one-way match
 * POST /api/matching/accept-interest
 * Body: { matchId, userId }
 */
router.post('/accept-interest', acceptInterest);

/**
 * Like a match (mutual matches)
 * POST /api/matching/like
 * Body: { matchId, userId, isSecondChance }
 */
router.post('/like', likeMatch);

/**
 * Pass on a match (both one-way and mutual)
 * POST /api/matching/pass
 * Body: { matchId, userId, isSecondChance }
 */
router.post('/pass', passMatch);

/**
 * Get match details
 * GET /api/matching/match-details
 * Query: ?matchId=xxx&userId=xxx
 */
router.get('/match-details', getMatchDetails);

// ===== OPTIONAL: Keep old routes if you have other controllers =====
// If you have a separate controller for daily matching jobs, uncomment these:

// const {
//   runDailyMatching,
//   getMatchingStatus,
//   getMatchesByUserId,
//   getMatchesByEmail
// } = require('../controllers/dailyMatchingController'); // or wherever these are

// /**
//  * Manually trigger daily matching (for testing)
//  * POST /api/matching/run-daily
//  */
// router.post('/run-daily', runDailyMatching);

// /**
//  * Get daily matching job status
//  * GET /api/matching/status
//  */
// router.get('/status', getMatchingStatus);

// /**
//  * Get matches for a specific user by user ID
//  * GET /api/matching/matches/:userId
//  */
// router.get('/matches/:userId', getMatchesByUserId);

// /**
//  * Get matches for a user by email
//  * GET /api/matching/matches-by-email/:email
//  */
// router.get('/matches-by-email/:email', getMatchesByEmail);

module.exports = router;