const path = require('path');
const { db } = require('../config/firebase');
const Anthropic = require('@anthropic-ai/sdk');

// Initialize Claude API client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const parsePersonalityAnalysis = (claudeResponse) => {
  try {
    // Try to extract JSON from Claude's response
    let analysisData = null;
    
    // Look for JSON structure in the response
    const jsonMatch = claudeResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        analysisData = JSON.parse(jsonMatch[0]);
      } catch (jsonError) {
        console.warn('⚠️ Failed to parse JSON, falling back to text parsing');
      }
    }
    
    // If JSON parsing worked, return the structured data
    if (analysisData) {
      return {
        corePersonality: analysisData.corePersonality || {
          primaryTraits: [],
          strengths: [],
          preferences: []
        },
        relationshipStyle: analysisData.relationshipStyle || {
          attachmentStyle: 'Unknown',
          communicationStyle: 'Not available',
          conflictResolution: 'Not available'
        },
        compatibilityFactors: analysisData.compatibilityFactors || {
          dealBreakers: [],
          mustHaves: [],
          flexibleAreas: []
        },
        personalityScore: analysisData.personalityScore || {
          openness: 50,
          conscientiousness: 50,
          extraversion: 50,
          agreeableness: 50,
          neuroticism: 50
        },
        matchingInsights: analysisData.matchingInsights || {
          idealPartnerType: 'Analysis in progress',
          compatibilityPredictors: [],
          relationshipAdvice: 'Complete profile for detailed advice'
        }
      };
    }
    
    // Fallback: Parse from text format (legacy support)
    const textAnalysis = parseFromTextFormat(claudeResponse);
    return textAnalysis;
    
  } catch (error) {
    console.error('❌ Error parsing personality analysis:', error);
    return getDefaultAnalysisStructure();
  }
};

const parseFromTextFormat = (claudeResponse) => {  
  try {
    const analysis = {
      corePersonality: {
        primaryTraits: extractListFromText(claudeResponse, 'PRIMARY TRAITS:', 'STRENGTHS:'),
        strengths: extractListFromText(claudeResponse, 'STRENGTHS:', 'PREFERENCES:'),
        preferences: extractListFromText(claudeResponse, 'PREFERENCES:', 'ATTACHMENT')
      },
      relationshipStyle: {
        attachmentStyle: extractSingleValue(claudeResponse, 'Attachment Style:', '\n') || 'Secure',
        communicationStyle: extractSingleValue(claudeResponse, 'Communication Style:', '\n') || 'Direct and honest communication',
        conflictResolution: extractSingleValue(claudeResponse, 'Conflict Resolution:', '\n') || 'Collaborative problem-solving approach'
      },
      compatibilityFactors: {
        dealBreakers: extractListFromText(claudeResponse, 'DEAL BREAKERS:', 'MUST HAVES:'),
        mustHaves: extractListFromText(claudeResponse, 'MUST HAVES:', 'FLEXIBLE'),
        flexibleAreas: extractListFromText(claudeResponse, 'FLEXIBLE AREAS:', 'PERSONALITY SCORES:')
      },
      personalityScore: {
        openness: extractScore(claudeResponse, 'Openness') || 75,
        conscientiousness: extractScore(claudeResponse, 'Conscientiousness') || 75,
        extraversion: extractScore(claudeResponse, 'Extraversion') || 60,
        agreeableness: extractScore(claudeResponse, 'Agreeableness') || 80,
        neuroticism: extractScore(claudeResponse, 'Neuroticism') || 30
      },
      matchingInsights: {
        idealPartnerType: extractSingleValue(claudeResponse, 'IDEAL PARTNER:', 'COMPATIBILITY') || 'Someone who shares your values and complements your personality',
        compatibilityPredictors: extractListFromText(claudeResponse, 'COMPATIBILITY PREDICTORS:', 'RELATIONSHIP ADVICE:'),
        relationshipAdvice: extractSingleValue(claudeResponse, 'RELATIONSHIP ADVICE:', '**') || 'Focus on open communication and shared goals'
      }
    };
    
    return analysis;
    
  } catch (error) {
    console.error('❌ Error in text format parsing:', error);
    return getDefaultAnalysisStructure();
  }
};

const extractListFromText = (text, startMarker, endMarker) => {
  try {
    const startIndex = text.indexOf(startMarker);
    const endIndex = text.indexOf(endMarker);
    
    if (startIndex === -1) return [];
    
    const section = text.substring(startIndex + startMarker.length, endIndex > startIndex ? endIndex : text.length);
    const items = section.split('\n')
      .map(line => line.trim())
      .filter(line => line && line.length > 0 && !line.includes(':'))
      .map(line => line.replace(/^[-•*]\s*/, '').trim())
      .filter(line => line.length > 2);
    
    return items.slice(0, 5); // Limit to 5 items max
  } catch (error) {
    console.warn('⚠️ Error extracting list:', error);
    return [];
  }
};

const extractSingleValue = (text, marker, delimiter) => {
  try {
    const startIndex = text.indexOf(marker);
    if (startIndex === -1) return null;
    
    const afterMarker = text.substring(startIndex + marker.length);
    const endIndex = afterMarker.indexOf(delimiter);
    
    const value = afterMarker.substring(0, endIndex > 0 ? endIndex : 100).trim();
    return value.length > 0 ? value : null;
  } catch (error) {
    console.warn('⚠️ Error extracting single value:', error);
    return null;
  }
};

const extractScore = (text, trait) => {
  try {
    const regex = new RegExp(`${trait}[:\\s]*(\\d+)(?:/100)?`, 'i');
    const match = text.match(regex);
    return match ? parseInt(match[1]) : null;
  } catch (error) {
    console.warn(`⚠️ Could not extract score for ${trait}`);
    return null;
  }
};

const getDefaultAnalysisStructure = () => {
  return {
    corePersonality: {
      primaryTraits: ['Thoughtful', 'Caring', 'Curious'],
      strengths: ['Good listener', 'Empathetic', 'Reliable'],
      preferences: ['Meaningful conversations', 'Quality time', 'Shared experiences']
    },
    relationshipStyle: {
      attachmentStyle: 'Secure',
      communicationStyle: 'Open and honest communication with a focus on understanding',
      conflictResolution: 'Collaborative approach to solving problems together'
    },
    compatibilityFactors: {
      dealBreakers: ['Dishonesty', 'Lack of respect'],
      mustHaves: ['Emotional intelligence', 'Shared values'],
      flexibleAreas: ['Hobbies', 'Social preferences']
    },
    personalityScore: {
      openness: 75,
      conscientiousness: 70,
      extraversion: 60,
      agreeableness: 85,
      neuroticism: 25
    },
    matchingInsights: {
      idealPartnerType: 'Someone who values emotional connection and personal growth',
      compatibilityPredictors: ['Shared values', 'Communication style', 'Life goals'],
      relationshipAdvice: 'Focus on building trust through consistent communication and shared experiences'
    }
  };
};

const getFirstQuestion = async (req, res) => {
  try {
    // Read questions from JSON file
    const questionsPath = path.join(__dirname, '../data/questions.json');
    const questionsData = require(questionsPath);
    
    // Get the first question
    const firstQuestion = questionsData.matchingQuestions[0];
    
    if (!firstQuestion) {
      return res.status(404).json({
        status: 'error',
        message: 'No questions found'
      });
    }    
    res.status(200).json({
      status: 'success',
      data: {
        question: firstQuestion
      }
    });
    
  } catch (error) {
    console.error('❌ Error getting first question:', error);
    
    res.status(500).json({
      status: 'error',
      message: 'Failed to get question',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

const getEnrichmentQuestion = async (req, res) => {
  try {
    
    // Read questions from JSON file
    const questionsPath = path.join(__dirname, '../data/questions.json');
    const questionsData = require(questionsPath);
    
    // Get question 9 (index 8)
    const enrichmentQuestion = questionsData.matchingQuestions[8];
    
    if (!enrichmentQuestion) {
      return res.status(404).json({
        status: 'error',
        message: 'Enrichment question not found'
      });
    }    
    res.status(200).json({
      status: 'success',
      data: {
        question: enrichmentQuestion
      }
    });
    
  } catch (error) {
    console.error('❌ Error getting enrichment question:', error);
    
    res.status(500).json({
      status: 'error',
      message: 'Failed to get enrichment question',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

const callClaudeAPI = async (questionsAndAnswers, userInfo) => {
  try {    
    // Create the prompt for structured JSON response
    const prompt = `You are an expert relationship psychologist and personality analyst. I need you to analyze the following dating profile responses and provide a comprehensive personality assessment for compatibility matching purposes.

USER INFORMATION:
Name: ${userInfo.firstName} ${userInfo.lastName}
Age: ${userInfo.age}
Gender: ${userInfo.gender}
Looking for: ${userInfo.lookingFor}

QUESTIONS AND RESPONSES:
${questionsAndAnswers.map((qa, index) => `
QUESTION ${qa.questionId}: ${qa.question}
ANSWER: ${qa.answer}
`).join('\n')}

Please analyze these responses and provide a detailed personality assessment. Return your analysis in the following exact JSON format:

{
  "corePersonality": {
    "primaryTraits": ["trait1", "trait2", "trait3"],
    "strengths": ["strength1", "strength2", "strength3"],
    "preferences": ["preference1", "preference2", "preference3"]
  },
  "relationshipStyle": {
    "attachmentStyle": "secure/anxious/avoidant/disorganized",
    "communicationStyle": "detailed description of communication style",
    "conflictResolution": "description of how they handle conflicts"
  },
  "compatibilityFactors": {
    "dealBreakers": ["dealbreaker1", "dealbreaker2"],
    "mustHaves": ["musthave1", "musthave2"],
    "flexibleAreas": ["flexible1", "flexible2"]
  },
  "personalityScore": {
    "openness": 85,
    "conscientiousness": 75,
    "extraversion": 60,
    "agreeableness": 90,
    "neuroticism": 25
  },
  "matchingInsights": {
    "idealPartnerType": "description of ideal partner",
    "compatibilityPredictors": ["predictor1", "predictor2"],
    "relationshipAdvice": "personalized relationship advice"
  }
}

Please ensure all scores are realistic (0-100) and based on evidence from their responses. Be thorough and specific in your analysis, as this will be used for matching compatible partners.`;

    
    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 2000,
      temperature: 0.7,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });
    return response.content[0].text;
  } catch (error) {
    console.error('❌ Claude API Error:', error);
    throw error;
  }
};

const saveAnswerAndGetNext = async (req, res) => {
  try {
    const { email, questionId, answer } = req.body;
    
    if (!email || !questionId || !answer) {
      return res.status(400).json({
        status: 'error',
        message: 'Email, questionId, and answer are required'
      });
    }
    
    // Find user by email
    const usersRef = db.collection('users');
    const snapshot = await usersRef.where('email', '==', email).get();
    
    if (snapshot.empty) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found'
      });
    }
    
    const userDoc = snapshot.docs[0];
    const userId = userDoc.id;
    const userData = userDoc.data();
    
    // Save the answer
    const answerData = {
      questionId: parseInt(questionId),
      answer: answer,
      answeredAt: new Date()
    };
    
    // Update user document with the answer
    await userDoc.ref.update({
      [`answers.question${questionId}`]: answerData,
      updatedAt: new Date()
    });
    
    // Check if this was the last question (question 8) - FIXED: Only 8 questions for now
    if (parseInt(questionId) === 8) {
      
      try {
        // Get all questions from JSON file
        const questionsPath = path.join(__dirname, '../data/questions.json');
        const questionsData = require(questionsPath);
        
        // Compile questions and answers (ONLY FIRST 8 QUESTIONS)
        const questionsAndAnswers = [];
        for (let i = 1; i <= 8; i++) {
          const questionData = questionsData.matchingQuestions[i - 1]; // Array is 0-indexed
          const answerKey = `question${i}`;
          
          // Get answer from user document (either from current update or existing data)
          let userAnswer;
          if (i === parseInt(questionId)) {
            userAnswer = answer; // Current answer
          } else {
            // Get from saved answers
            const savedAnswers = userData.answers || {};
            userAnswer = savedAnswers[answerKey]?.answer || '';
          }
          
          questionsAndAnswers.push({
            questionId: i,
            question: questionData.question,
            answer: userAnswer
          });
        }        
        // Call Claude API
        const claudeResponse = await callClaudeAPI(questionsAndAnswers, userData);
        
        // Parse personality analysis from Claude response - NEW PARSING
        const personalityAnalysis = parsePersonalityAnalysis(claudeResponse);
        
        // Prepare personality analysis data to save - NEW STRUCTURE
        const analysisData = {
          ...personalityAnalysis, // Spread the parsed analysis directly
          rawAnalysis: claudeResponse,
          analyzedAt: new Date(),
          analysisVersion: '1.0'
        };
        
        // Save personality analysis to user document
        await userDoc.ref.update({
          personalityAnalysis: analysisData,
          isAnalysisComplete: true,
          updatedAt: new Date()
        });
        
        // Get updated user data with personality analysis
        const updatedUserSnapshot = await userDoc.ref.get();
        const updatedUserData = updatedUserSnapshot.data();
                
        // FIXED: Return here to prevent further execution
        return res.status(200).json({
          status: 'success',
          message: 'All questions completed',
          data: {
            isComplete: true,
            userData: updatedUserData
          }
        });
        
      } catch (claudeError) {
        console.error('❌ Claude API analysis failed:', claudeError);
        
        // FIXED: Return here even if Claude fails to prevent further execution
        return res.status(200).json({
          status: 'success',
          message: 'All questions completed - analysis failed',
          data: {
            isComplete: true,
            userData: userData
          }
        });
      }
    }
    
    // Get next question (ONLY if questionId < 8)
    const questionsPath = path.join(__dirname, '../data/questions.json');
    const questionsData = require(questionsPath);
    
    const nextQuestionIndex = parseInt(questionId); // questionId 1 gets question[1] (2nd question)
    const nextQuestion = questionsData.matchingQuestions[nextQuestionIndex];
    
    if (!nextQuestion) {
      return res.status(404).json({
        status: 'error',
        message: 'Next question not found'
      });
    }    
    res.status(200).json({
      status: 'success',
      data: {
        question: nextQuestion,
        isComplete: false
      }
    });
    
  } catch (error) {
    console.error('❌ Error saving answer and getting next question:', error);
    
    res.status(500).json({
      status: 'error',
      message: 'Failed to save answer and get next question',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

const saveEnrichmentAnswerAndGetNext = async (req, res) => {
  try {
    
    const { email, questionId, answer } = req.body;
    
    if (!email || !questionId || !answer) {
      return res.status(400).json({
        status: 'error',
        message: 'Email, questionId, and answer are required'
      });
    }
    
    // Find user by email
    const usersRef = db.collection('users');
    const snapshot = await usersRef.where('email', '==', email).get();
    
    if (snapshot.empty) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found'
      });
    }
    
    const userDoc = snapshot.docs[0];
    const userId = userDoc.id;
    const userData = userDoc.data();
    
    // Save the answer
    const answerData = {
      questionId: parseInt(questionId),
      answer: answer,
      answeredAt: new Date()
    };
    
    // Update user document with the answer
    await userDoc.ref.update({
      [`answers.question${questionId}`]: answerData,
      updatedAt: new Date()
    });
    
    
    // Check if this was the last enrichment question (question 15)
    if (parseInt(questionId) === 15) {      
      try {
        // Get all questions from JSON file
        const questionsPath = path.join(__dirname, '../data/questions.json');
        const questionsData = require(questionsPath);
        
        // Compile questions and answers (ALL 15 QUESTIONS)
        const questionsAndAnswers = [];
        for (let i = 1; i <= 15; i++) {
          const questionData = questionsData.matchingQuestions[i - 1]; // Array is 0-indexed
          const answerKey = `question${i}`;
          
          // Get answer from user document (either from current update or existing data)
          let userAnswer;
          if (i === parseInt(questionId)) {
            userAnswer = answer; // Current answer
          } else {
            // Get from saved answers
            const savedAnswers = userData.answers || {};
            userAnswer = savedAnswers[answerKey]?.answer || '';
          }
          
          questionsAndAnswers.push({
            questionId: i,
            question: questionData.question,
            answer: userAnswer
          });
        }        
        // Call Claude API with all 15 questions
        const claudeResponse = await callClaudeAPI(questionsAndAnswers, userData);
        
        // Parse enhanced personality analysis from Claude response
        const enhancedPersonalityAnalysis = parsePersonalityAnalysis(claudeResponse);
        
        // Prepare enhanced personality analysis data to save - NEW STRUCTURE
        const enhancedAnalysisData = {
          ...enhancedPersonalityAnalysis, // Spread the parsed analysis directly
          rawAnalysis: claudeResponse,
          analyzedAt: new Date(),
          analysisVersion: '2.0', // Enhanced version with 15 questions
          isEnriched: true
        };
        
        // Save enhanced personality analysis to user document
        await userDoc.ref.update({
          personalityAnalysis: enhancedAnalysisData,
          isAnalysisComplete: true,
          isEnrichmentComplete: true,
          updatedAt: new Date()
        });
        
        // Get updated user data with enhanced personality analysis
        const updatedUserSnapshot = await userDoc.ref.get();
        const updatedUserData = updatedUserSnapshot.data();
        
        
        // Return completion response
        return res.status(200).json({
          status: 'success',
          message: 'All enrichment questions completed',
          data: {
            isComplete: true,
            isEnriched: true,
            userData: updatedUserData
          }
        });
        
      } catch (claudeError) {
        console.error('❌ Enhanced Claude API analysis failed:', claudeError);
        
        // Return completion even if Claude fails
        return res.status(200).json({
          status: 'success',
          message: 'All enrichment questions completed - analysis failed',
          data: {
            isComplete: true,
            isEnriched: false,
            userData: userData
          }
        });
      }
    }
    
    // Get next enrichment question (questions 9-14)
    const questionsPath = path.join(__dirname, '../data/questions.json');
    const questionsData = require(questionsPath);
    
    const nextQuestionIndex = parseInt(questionId); // questionId 9 gets question[9] (10th question)
    const nextQuestion = questionsData.matchingQuestions[nextQuestionIndex];
    
    if (!nextQuestion) {
      return res.status(404).json({
        status: 'error',
        message: 'Next enrichment question not found'
      });
    }    
    res.status(200).json({
      status: 'success',
      data: {
        question: nextQuestion,
        isComplete: false
      }
    });
    
  } catch (error) {
    console.error('❌ Error saving enrichment answer and getting next question:', error);
    
    res.status(500).json({
      status: 'error',
      message: 'Failed to save enrichment answer and get next question',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

const getQuestions = async (req, res) => {
  try {
    
    // Read questions from JSON file
    const questionsPath = path.join(__dirname, '../data/questions.json');
    const questionsData = require(questionsPath);
    
    // Return all questions
    res.status(200).json({
      status: 'success',
      matchingQuestions: questionsData.matchingQuestions
    });
    
  } catch (error) {
    console.error('❌ Error fetching questions:', error);
    
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch questions',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

module.exports = {
  getFirstQuestion,
  saveAnswerAndGetNext,
  getEnrichmentQuestion,
  saveEnrichmentAnswerAndGetNext, 
  getQuestions
};