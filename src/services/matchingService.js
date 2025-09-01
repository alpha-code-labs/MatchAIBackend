const { db } = require('../config/firebase');

class MatchingService {
  constructor() {
    this.dailyMatchLimit = 5;
    this.matchThreshold = 30; // Lowered to ensure more matches
  }

  /**
   * CRITICAL FIX: Normalize gender values for consistent comparison
   */
  normalizeGenderValue(value) {
    if (!value) return '';
    
    const normalized = value.toLowerCase().trim();
    
    // Map all variations to standard values
    const genderMap = {
      'male': 'male',
      'man': 'male',
      'men': 'male',
      'female': 'female',
      'woman': 'female',
      'women': 'female',
      'non-binary': 'non-binary',
      'nonbinary': 'non-binary',
      'other': 'other',
      'everyone': 'everyone',
      'both': 'everyone',
      'all': 'everyone'
    };
    
    return genderMap[normalized] || normalized;
  }

  /**
   * FIXED: Check if two users are compatible based on gender preferences
   */
  checkGenderCompatibility(user1, user2) {
    // Normalize all gender values for comparison
    const user1Gender = this.normalizeGenderValue(user1.gender);
    const user1InterestedIn = this.normalizeGenderValue(user1.interestedIn);
    const user2Gender = this.normalizeGenderValue(user2.gender);
    const user2InterestedIn = this.normalizeGenderValue(user2.interestedIn);
    
    
    // Check if user1 is interested in user2's gender
    let user1Interested = false;
    if (user1InterestedIn === 'everyone') {
      user1Interested = true;
    } else if (user1InterestedIn === user2Gender) {
      user1Interested = true;
    }
    
    // Check if user2 is interested in user1's gender
    let user2Interested = false;
    if (user2InterestedIn === 'everyone') {
      user2Interested = true;
    } else if (user2InterestedIn === user1Gender) {
      user2Interested = true;
    }
    
    const isCompatible = user1Interested && user2Interested;
    return isCompatible;
  }

  /**
   * Run daily matching for all active users
   */
  async runDailyMatching() {
    try {
      const startTime = Date.now();

      // Get all active users who have completed personality analysis
      const activeUsers = await this.getActiveUsers();

      const allMatches = [];
      const processedPairs = new Set();

      // Process matches for each user
      for (const user of activeUsers) {
        
        // FIXED: Get ALL historical matches for this user (not just today's)
        const allHistoricalMatches = await this.getAllMatchesForUser(user.id);
        
        // Get today's NEW matches (for daily limit calculation)
        const todayNewMatches = await this.getTodayNewMatches(user.id);
        const remainingSlots = this.dailyMatchLimit - todayNewMatches.length;
        
        if (remainingSlots <= 0) {
          continue;
        }

        // Get potential matches for this user (excluding ALL historical matches)
        const candidates = await this.findCandidates(user, allHistoricalMatches);

        if (candidates.length === 0) {
          continue;
        }

        // Score and rank candidates based on user's selected algorithm
        const scoredCandidates = this.scoreCandidates(user, candidates);
        
        // Filter by minimum threshold and sort by score
        const validMatches = scoredCandidates
          .filter(match => match.score >= this.matchThreshold)
          .sort((a, b) => b.score - a.score)
          .slice(0, remainingSlots);

        // Add to matches array with user context
        validMatches.forEach(match => {
          const pairKey = [user.id, match.candidateId].sort().join('-');
          
          allMatches.push({
            user1_id: user.id,
            user2_id: match.candidateId,
            user1_score: match.score,
            user1_algorithm: match.algorithm,
            user1_reason: match.reason,
            pairKey: pairKey
          });
        });
      }

      // Process matches to determine mutual vs one-way
      
      const processedMatches = this.processMatches(allMatches);

      // Save matches to database
      const savedMatches = await this.saveMatches(processedMatches);

      const duration = ((Date.now() - startTime) / 1000).toFixed(3);
      
      const result = {
        success: true,
        usersProcessed: activeUsers.length,
        matchesCreated: savedMatches.length,
        mutualCount: processedMatches.mutual.length,
        oneWayCount: processedMatches.oneWay.length,
        duration: parseFloat(duration),
        newMatches: savedMatches
      };
      return result;

    } catch (error) {
      console.error('❌ Daily matching failed:', error);
      throw error;
    }
  }

  /**
   * Get all active users who have completed personality analysis
   */
  async getActiveUsers() {
    const snapshot = await db.collection('users')
      .where('isActive', '==', true)
      .where('isAnalysisComplete', '==', true)
      .get();
    
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
  }

  /**
   * NEW: Get ALL historical matches for a user (to prevent duplicates)
   */
  async getAllMatchesForUser(userId) {
    const snapshot = await db.collection('matches').get();
    
    // Filter for ALL matches involving this user (regardless of date or status)
    return snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(match => 
        match.user1_id === userId || match.user2_id === userId
      );
  }

  /**
   * Get today's NEW matches for a user (for daily limit)
   */
  async getTodayNewMatches(userId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const snapshot = await db.collection('matches')
      .where('created_at', '>=', today)
      .get();
    
    // Filter for matches created TODAY involving this user
    return snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(match => 
        match.user1_id === userId || match.user2_id === userId
      );
  }

  /**
   * Find potential candidates for a user
   */
  async findCandidates(user, allHistoricalMatches) {
    const candidates = [];
    const allUsers = await this.getActiveUsers();
    
    // Get IDs of ALL users ever matched (not just today)
    const alreadyMatchedUserIds = new Set();
    allHistoricalMatches.forEach(match => {
      if (match.user1_id === user.id) {
        alreadyMatchedUserIds.add(match.user2_id);
      } else {
        alreadyMatchedUserIds.add(match.user1_id);
      }
    });

    for (const candidate of allUsers) {
      // Skip self
      if (candidate.id === user.id) continue;
      
      // Skip if EVER matched before (not just today)
      if (alreadyMatchedUserIds.has(candidate.id)) {
        continue;
      }

      // FIXED: Use normalized gender compatibility check
      if (!this.checkGenderCompatibility(user, candidate)) {
        continue;
      }

      // Check if looking for same things (with normalization)
      const userLookingFor = this.normalizeLookingFor(user.lookingFor);
      const candidateLookingFor = this.normalizeLookingFor(candidate.lookingFor);
      
      // Compatible if both want friendship, both want dating, or either wants "both"
      const lookingForCompatible = 
        userLookingFor === candidateLookingFor ||
        userLookingFor === 'both' ||
        candidateLookingFor === 'both';
      
      if (!lookingForCompatible) {
        continue;
      }
      candidates.push(candidate);
    }

    return candidates;
  }

  /**
   * Normalize lookingFor values
   */
  normalizeLookingFor(value) {
    if (!value) return '';
    
    const normalized = value.toLowerCase().trim();
    const lookingForMap = {
      'friendship': 'friendship',
      'friends': 'friendship',
      'dating': 'dating',
      'dating/relationships': 'dating',
      'relationships': 'dating',
      'long-term': 'dating',
      'both': 'both',
      'all': 'both'
    };
    
    return lookingForMap[normalized] || normalized;
  }

  /**
   * Score candidates based on user's selected matching algorithm
   */
  scoreCandidates(user, candidates) {
    const scoredCandidates = [];
    
    // Determine which algorithm to use
    let algorithm = 'similarity'; // default
    if (user.similarityMatching) algorithm = 'similarity';
    else if (user.complementaryMatching) algorithm = 'complementary';
    else if (user.multiDimensionalMatching) algorithm = 'multiDimensional';
    else if (user.dealBreakerFiltering) algorithm = 'dealBreaker';
    
    for (const candidate of candidates) {
      let score = 0;
      let reason = '';

      switch (algorithm) {
        case 'similarity':
          score = this.calculateSimilarityScore(user, candidate);
          reason = 'High personality and lifestyle compatibility';
          break;
        case 'complementary':
          score = this.calculateComplementaryScore(user, candidate);
          reason = 'Perfect personality balance and complementary traits';
          break;
        case 'multiDimensional':
          score = this.calculateMultiDimensionalScore(user, candidate);
          reason = 'Comprehensive compatibility across multiple dimensions';
          break;
        case 'dealBreaker':
          score = this.calculateDealBreakerScore(user, candidate);
          reason = 'No deal-breakers detected, all must-haves matched';
          break;
      }

      // Apply location bonus (30% boost for same city)
      if (user.city && candidate.city && 
          user.city.toLowerCase() === candidate.city.toLowerCase()) {
        score = Math.min(100, score * 1.3);
      }

      // Apply age compatibility bonus
      if (user.age && candidate.age) {
        const ageDiff = Math.abs(user.age - candidate.age);
        let ageBonus = 0;
        if (ageDiff <= 2) ageBonus = 10;
        else if (ageDiff <= 5) ageBonus = 5;
        else if (ageDiff <= 10) ageBonus = 2;
        
        score = Math.min(100, score + ageBonus);
      }

      scoredCandidates.push({
        candidateId: candidate.id,
        candidateData: candidate,
        score: Math.round(score),
        algorithm: algorithm,
        reason: reason
      });
    }

    return scoredCandidates;
  }

  /**
   * Calculate similarity score between two users
   */
  calculateSimilarityScore(user1, user2) {
    let score = 50; // Base score

    // Compare personality scores if available
    if (user1.personalityAnalysis?.personalityScore && 
        user2.personalityAnalysis?.personalityScore) {
      
      const traits = ['openness', 'conscientiousness', 'extraversion', 
                     'agreeableness', 'neuroticism'];
      let totalDifference = 0;
      
      traits.forEach(trait => {
        const diff = Math.abs(
          (user1.personalityAnalysis.personalityScore[trait] || 50) - 
          (user2.personalityAnalysis.personalityScore[trait] || 50)
        );
        totalDifference += diff;
      });
      
      // Average difference per trait
      const avgDifference = totalDifference / traits.length;
      // Convert to similarity score (0-100)
      score = Math.max(0, 100 - (avgDifference * 2));
    }

    // Bonus for same relationship status
    if (user1.relationshipStatus === user2.relationshipStatus) {
      score += 5;
    }

    return Math.min(100, score);
  }

  /**
   * Calculate complementary score (opposites attract)
   */
  calculateComplementaryScore(user1, user2) {
    let score = 50; // Base score

    if (user1.personalityAnalysis?.personalityScore && 
        user2.personalityAnalysis?.personalityScore) {
      
      const scores1 = user1.personalityAnalysis.personalityScore;
      const scores2 = user2.personalityAnalysis.personalityScore;
      
      // Look for complementary traits (one high, one low)
      let complementaryCount = 0;
      
      // Extraversion: introvert + extrovert
      if ((scores1.extraversion > 70 && scores2.extraversion < 30) ||
          (scores1.extraversion < 30 && scores2.extraversion > 70)) {
        complementaryCount++;
      }
      
      // Neuroticism: anxious + calm
      if ((scores1.neuroticism > 70 && scores2.neuroticism < 30) ||
          (scores1.neuroticism < 30 && scores2.neuroticism > 70)) {
        complementaryCount++;
      }
      
      // Calculate balance score (should average to ~50)
      const traits = ['openness', 'conscientiousness', 'extraversion', 
                     'agreeableness', 'neuroticism'];
      let totalBalance = 0;
      
      traits.forEach(trait => {
        const avg = ((scores1[trait] || 50) + (scores2[trait] || 50)) / 2;
        const balanceScore = 100 - Math.abs(avg - 50) * 2;
        totalBalance += balanceScore;
      });
      
      score = (totalBalance / traits.length) + (complementaryCount * 10);
    }

    return Math.min(100, score);
  }

  /**
   * Calculate multi-dimensional score
   */
  calculateMultiDimensionalScore(user1, user2) {
    // Start with average of similarity and complementary
    const similarity = this.calculateSimilarityScore(user1, user2);
    const complementary = this.calculateComplementaryScore(user1, user2);
    let score = (similarity + complementary) / 2;

    // Add bonuses for matching on specific dimensions
    if (user1.personalityAnalysis?.relationshipStyle && 
        user2.personalityAnalysis?.relationshipStyle) {
      
      // Bonus for same attachment style
      if (user1.personalityAnalysis.relationshipStyle.attachmentStyle === 
          user2.personalityAnalysis.relationshipStyle.attachmentStyle) {
        score += 10;
      }
      
      // Bonus for compatible communication styles
      if (user1.personalityAnalysis.relationshipStyle.communicationStyle && 
          user2.personalityAnalysis.relationshipStyle.communicationStyle) {
        score += 5;
      }
    }

    return Math.min(100, score);
  }

  /**
   * Calculate deal-breaker score
   */
  calculateDealBreakerScore(user1, user2) {
    let score = 70; // Start with good base score

    // Check deal breakers if available
    if (user1.personalityAnalysis?.compatibilityFactors?.dealBreakers) {
      const dealBreakers = user1.personalityAnalysis.compatibilityFactors.dealBreakers;
      
      // Check if candidate has any deal breakers
      // This is simplified - in production, you'd map specific traits to deal breakers
      if (dealBreakers.includes('dishonesty') || 
          dealBreakers.includes('lack of ambition')) {
        // These are common deal breakers - assume compatibility for now
        score += 10;
      }
    }

    // Check must-haves
    if (user1.personalityAnalysis?.compatibilityFactors?.mustHaves) {
      const mustHaves = user1.personalityAnalysis.compatibilityFactors.mustHaves;
      
      // Check if candidate meets must-haves
      // Simplified check - in production, map actual traits
      if (mustHaves.length > 0) {
        score += 10;
      }
    }

    // No critical deal breakers found
    return Math.min(100, score);
  }

  /**
   * Process matches to determine mutual vs one-way
   */
  processMatches(allMatches) {
    const mutual = [];
    const oneWay = [];
    const processedPairs = new Set();

    // Group matches by pair
    const matchesByPair = {};
    allMatches.forEach(match => {
      if (!matchesByPair[match.pairKey]) {
        matchesByPair[match.pairKey] = [];
      }
      matchesByPair[match.pairKey].push(match);
    });

    // Process each pair
    Object.entries(matchesByPair).forEach(([pairKey, matches]) => {
      if (matches.length === 2) {
        // Both users selected each other - mutual match
        const match1 = matches[0];
        const match2 = matches[1];        
        mutual.push({
          user1_id: match1.user1_id,
          user2_id: match1.user2_id,
          match_type: 'mutual_algorithm',
          user1_score: match1.user1_score,
          user2_score: match2.user1_score,
          user1_algorithm: match1.user1_algorithm,
          user2_algorithm: match2.user1_algorithm,
          user1_reason: match1.user1_reason,
          user2_reason: match2.user1_reason,
          combined_score: Math.round((match1.user1_score + match2.user1_score) / 2)
        });
      } else if (matches.length === 1) {
        // Only one user selected the other - one-way match
        const match = matches[0];        
        oneWay.push({
          user1_id: match.user1_id,
          user2_id: match.user2_id,
          match_type: 'one_way_interest',
          user1_score: match.user1_score,
          user1_algorithm: match.user1_algorithm,
          user1_reason: match.user1_reason,
          combined_score: match.user1_score
        });
      }
    });

    return { mutual, oneWay };
  }

  /**
   * Save processed matches to database
   */
  async saveMatches(processedMatches) {
    const { mutual, oneWay } = processedMatches;
    const allProcessedMatches = [...mutual, ...oneWay];
    
    if (allProcessedMatches.length === 0) {
      return [];
    }
    
    const savedMatches = [];
    const batch = db.batch();
    
    for (const match of allProcessedMatches) {
      const matchRef = db.collection('matches').doc();
      
      const matchData = {
        ...match,
        created_at: new Date(),
        // REMOVED: expires_at field - matches never expire
        status: 'active',
        
        // User action tracking
        user1_action: null,
        user2_action: null,
        user1_action_at: null,
        user2_action_at: null,
        
        // For one-way matches
        user1_expressed_interest: false,
        user2_expressed_interest: false,
        
        // For mutual matches
        is_mutual_match: match.match_type === 'mutual_algorithm',
        chat_unlocked: false,
        
        // Visibility flags
        visible_to_user1: true,
        visible_to_user2: match.match_type === 'mutual_algorithm', // One-way only visible after interest expressed
        
        // Notification flags
        user1_notified: false,
        user2_notified: false,
        email_sent_user1: false,
        email_sent_user2: false,
        // NEW: Like email tracking flags
        // like_email_pending_user1: false,
        // like_email_pending_user2: false,
        // like_email_sent_user1: false,
        // like_email_sent_user2: false,

        // NEW: Love email tracking flags
        // love_email_pending_user1: false,
        // love_email_pending_user2: false,
        // love_email_sent_user1: false,
        // love_email_sent_user2: false,
        // NEW: Interest email tracking flags
        // NEW: Generic notification tracking flags
        notification_pending_user1: false,
        notification_pending_user2: false,
        notification_sent_user1: false,
        notification_sent_user2: false

      };
      
      batch.set(matchRef, matchData);
      savedMatches.push(matchData);
    }
    
    await batch.commit();    
    return savedMatches;
  }
}

module.exports = MatchingService;