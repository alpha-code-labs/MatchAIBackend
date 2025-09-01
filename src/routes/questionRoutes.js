const express = require('express');
const {
  getFirstQuestion,
  saveAnswerAndGetNext,
  getEnrichmentQuestion,
  saveEnrichmentAnswerAndGetNext,
  getQuestions // Add this import
} = require('../controllers/questionController');
const router = express.Router();

// GET /api/questions/all - Get all questions for Questions tab
router.get('/all', getQuestions);

// Original routes for initial 8 questions
// GET /api/questions - Get first question
router.get('/', getFirstQuestion);

// POST /api/questions/answer - Save answer and get next question
router.post('/answer', saveAnswerAndGetNext);

// New routes for enrichment questions (9-15)
// GET /api/questions/enrichment - Get enrichment question (question 9)
router.get('/enrichment', getEnrichmentQuestion);

// POST /api/questions/enrichment/answer - Save enrichment answer and get next question
router.post('/enrichment/answer', saveEnrichmentAnswerAndGetNext);

module.exports = router;