const { db } = require('../config/firebase');
const azureStorage = require('../services/azureStorage');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken'); // Add this import for JWT handling

/**
 * Normalize user data for consistent storage
 * This ensures all data is stored in the same format throughout the app
 */
const normalizeUserData = (userData) => {
  const normalizeGender = (gender) => {
    if (!gender) return '';
    const genderMap = {
      'Man': 'male',
      'Woman': 'female', 
      'Non-binary': 'non-binary',
      'Other': 'prefer-not-to-say'
    };
    return genderMap[gender] || gender.toLowerCase();
  };

  const normalizeInterestedIn = (interestedIn) => {
    if (!interestedIn) return '';
    const interestedMap = {
      'Men': 'men',
      'Women': 'women',
      'Non-binary': 'non-binary',  // ✅ FIXED: Should map to 'both'
      'Everyone': 'both'     // ✅ FIXED: Should map to 'both'
    };
    return interestedMap[interestedIn] || interestedIn.toLowerCase();
  };

  const normalizeLookingFor = (lookingFor) => {
    if (!lookingFor) return '';
    const lookingForMap = {
      'Friendship': 'friendship',
      'Dating/Relationships': 'long-term',
      'Both': 'both'  // ✅ This was already correct
    };
    return lookingForMap[lookingFor] || lookingFor.toLowerCase();
  };

  const normalizeRelationshipStatus = (status) => {
    if (!status) return '';
    const statusMap = {
      'Single': 'single',
      'In a relationship': 'relationship',
      'Married': 'married',
      'It\'s complicated': 'complicated',
      'Prefer not to say': 'prefer-not-to-say'
    };
    return statusMap[status] || status.toLowerCase();
  };

  const normalized = {
    ...userData,
    gender: normalizeGender(userData.gender),
    interestedIn: normalizeInterestedIn(userData.interestedIn),
    lookingFor: normalizeLookingFor(userData.lookingFor),
    relationshipStatus: normalizeRelationshipStatus(userData.relationshipStatus)
  };
  return normalized;
};

/**
 * Helper function to get unnotified matches for a user
 */
/**
 * Helper function to get unnotified matches for a user - UPDATED: Expiry filter removed
 */
const getUnnotifiedMatches = async (userId) => {
  try {
    
    const matchesRef = db.collection('matches');
    
    // Get matches where user is user1 (visible to user1)
    const snapshot1 = await matchesRef
      .where('user1_id', '==', userId)
      .where('visible_to_user1', '==', true)
      .orderBy('created_at', 'desc')
      .get();

    // Get matches where user is user2 (visible to user2)
    const snapshot2 = await matchesRef
      .where('user2_id', '==', userId)
      .where('visible_to_user2', '==', true)
      .orderBy('created_at', 'desc')
      .get();

    const allMatches = [];
    const now = new Date();

    // Helper function to normalize action values (handle string "null" and empty strings)
    const normalizeAction = (action) => {
      return action === "null" || action === null || action === undefined || action === "" ? null : action;
    };

    // Helper function to build matched user data based on privacy settings
    const buildMatchedUserData = (userData) => {
      const matchedUserData = {
        id: userData.id,
        firstName: userData.firstName,
        lastName: userData.lastName,
        profilePicture: userData.profilePicture,
        profilePictures: userData.profilePictures
      };

      // Add full profile data if user allows it
      if (userData.showFullProfile) {
        matchedUserData.age = userData.age;
        matchedUserData.city = userData.city;
        matchedUserData.lookingFor = userData.lookingFor;
        matchedUserData.relationshipStatus = userData.relationshipStatus;
        matchedUserData.bioData = userData.bioData;
      }

      // Add personality data if user allows it
      if (userData.showPersonalityScore) {
        matchedUserData.personalityAnalysis = userData.personalityAnalysis;
        matchedUserData.responses = userData.responses;
        matchedUserData.answers = userData.answers;
      }

      return matchedUserData;
    };

    // Process matches where user is user1
    for (const doc of snapshot1.docs) {
      const matchData = doc.data();
      
      // Get matched user details (user2)
      const userRef = db.collection('users').doc(matchData.user2_id);
      const userDoc = await userRef.get();
      
      if (userDoc.exists) {
        const userData = userDoc.data();
        const matchedUserData = buildMatchedUserData(userData);
        
        // Calculate match status flags
        const isExpired = matchData.expires_at && matchData.expires_at.toDate() < now;
        const user1Action = normalizeAction(matchData.user1_action);
        const user2Action = normalizeAction(matchData.user2_action);
        
        const enrichedMatchData = {
          // Basic match info
          id: doc.id,
          matchType: matchData.match_type,
          userPosition: 'user1',
          matchedUser: matchedUserData,
          score: matchData.user1_score || matchData.combined_score,
          algorithm: matchData.user1_algorithm,
          reason: matchData.user1_reason,
          createdAt: matchData.created_at,
          expiresAt: matchData.expires_at,
          
          // User actions (normalized)
          userAction: user1Action,
          otherUserAction: user2Action,
          
          // Match state fields (with defaults)
          isMutualMatch: matchData.is_mutual_match || false,
          chatUnlocked: matchData.chat_unlocked || false,
          
          // Interest expression fields (with defaults)
          user1_expressed_interest: matchData.user1_expressed_interest || false,
          user2_expressed_interest: matchData.user2_expressed_interest || false,
          interest_expressed_at: matchData.interest_expressed_at || null,
          interest_responded_at: matchData.interest_responded_at || null,
          
          // Second chance fields (with defaults)
          user1_second_chance_offered: matchData.user1_second_chance_offered || false,
          user2_second_chance_offered: matchData.user2_second_chance_offered || false,
          user1_second_chance_response: matchData.user1_second_chance_response || null,
          user2_second_chance_response: matchData.user2_second_chance_response || null,
          
          // Match status tracking (with defaults)
          match_status: matchData.match_status || 'pending',
          last_action_by: matchData.last_action_by || null,
          last_action_at: matchData.last_action_at || null,
          
          // Status flags
          isExpired: isExpired,
          hasUserActed: user1Action !== null,
          hasOtherUserActed: user2Action !== null,
          isActive: !isExpired && user1Action === null,
          
          // IMPORTANT: Add raw match data for backend updates
          rawMatchData: matchData
        };
        
        allMatches.push(enrichedMatchData);
      }
    }

    // Process matches where user is user2
    for (const doc of snapshot2.docs) {
      const matchData = doc.data();
      
      // Get matched user details (user1)
      const userRef = db.collection('users').doc(matchData.user1_id);
      const userDoc = await userRef.get();
      
      if (userDoc.exists) {
        const userData = userDoc.data();
        const matchedUserData = buildMatchedUserData(userData);
        
        // Calculate match status flags
        const isExpired = matchData.expires_at && matchData.expires_at.toDate() < now;
        const user1Action = normalizeAction(matchData.user1_action);
        const user2Action = normalizeAction(matchData.user2_action);
        
        const enrichedMatchData = {
          // Basic match info
          id: doc.id,
          matchType: matchData.match_type,
          userPosition: 'user2',
          matchedUser: matchedUserData,
          score: matchData.user2_score || matchData.combined_score,
          algorithm: matchData.user2_algorithm,
          reason: matchData.user2_reason,
          createdAt: matchData.created_at,
          expiresAt: matchData.expires_at,
          
          // User actions (normalized, swapped perspective)
          userAction: user2Action,
          otherUserAction: user1Action,
          
          // Match state fields (with defaults)
          isMutualMatch: matchData.is_mutual_match || false,
          chatUnlocked: matchData.chat_unlocked || false,
          
          // Interest expression fields (with defaults)
          user1_expressed_interest: matchData.user1_expressed_interest || false,
          user2_expressed_interest: matchData.user2_expressed_interest || false,
          interest_expressed_at: matchData.interest_expressed_at || null,
          interest_responded_at: matchData.interest_responded_at || null,
          
          // Second chance fields (with defaults)
          user1_second_chance_offered: matchData.user1_second_chance_offered || false,
          user2_second_chance_offered: matchData.user2_second_chance_offered || false,
          user1_second_chance_response: matchData.user1_second_chance_response || null,
          user2_second_chance_response: matchData.user2_second_chance_response || null,
          
          // Match status tracking (with defaults)
          match_status: matchData.match_status || 'pending',
          last_action_by: matchData.last_action_by || null,
          last_action_at: matchData.last_action_at || null,
          
          // Status flags
          isExpired: isExpired,
          hasUserActed: user2Action !== null,
          hasOtherUserActed: user1Action !== null,
          isActive: !isExpired && user2Action === null,
          
          // IMPORTANT: Add raw match data for backend updates
          rawMatchData: matchData
        };
        
        allMatches.push(enrichedMatchData);
      }
    }

    // Sort all matches by creation date (newest first)
    allMatches.sort((a, b) => {
      const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : a.createdAt;
      const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : b.createdAt;
      return dateB - dateA;
    });


    // ===============================
    // ENHANCED CATEGORIZATION LOGIC
    // ===============================

    const oneWayMatches = [];
    const mutualMatches = [];
    const loveMatches = [];

    allMatches.forEach(match => {
      // LOVE MATCHES: Chat is unlocked (both users have liked each other)
      if (match.chatUnlocked) {
        loveMatches.push({
          ...match,
          category: 'love',
          showButtons: false,
          buttonText: null,
          description: 'You both liked each other! Start chatting.'
        });
        return;
      }

      // ONE-WAY MATCHES
      if (match.matchType === 'one_way_interest') {
        
        if (match.userPosition === 'user1') {
          // User1 perspective: Can express interest or pass
          if (!match.user1_expressed_interest) {
            // Haven't expressed interest yet
            oneWayMatches.push({
              ...match,
              category: 'oneway',
              showButtons: true,
              buttonText: { primary: 'Express Your Interest', secondary: 'Pass' },
              description: 'We think this profile is a great match for you!'
            });
          } else {
            // Already expressed interest, awaiting response
            oneWayMatches.push({
              ...match,
              category: 'oneway',
              showButtons: false,
              buttonText: { primary: 'Awaiting Reply', secondary: null },
              description: 'Your interest has been sent. Waiting for their response.'
            });
          }
        } else {
          // User2 perspective: Only see after user1 expresses interest
          if (match.user1_expressed_interest) {
            if (!match.hasUserActed) {
              // User1 expressed interest, user2 needs to respond
              oneWayMatches.push({
                ...match,
                category: 'oneway',
                showButtons: true,
                buttonText: { primary: 'Accept', secondary: 'Pass' },
                description: 'Someone is interested in you!'
              });
            } else {
              // User2 already responded - hide from one-way matches
              // (Will either be in love matches if accepted, or deleted if passed)
            }
          }
          // If user1 hasn't expressed interest, user2 doesn't see this match at all
        }
        return;
      }

      // MUTUAL MATCHES
      if (match.matchType === 'mutual_algorithm') {
        
        // Both users haven't acted yet
        if (!match.hasUserActed && !match.hasOtherUserActed) {
          mutualMatches.push({
            ...match,
            category: 'mutual',
            showButtons: true,
            buttonText: { primary: 'Like', secondary: 'Pass' },
            description: 'You both showed up in each other\'s matches!'
          });
          return;
        }

        // Current user acted, waiting for other user
        if (match.hasUserActed && !match.hasOtherUserActed) {
          mutualMatches.push({
            ...match,
            category: 'mutual',
            showButtons: false,
            buttonText: { primary: 'Awaiting Reply', secondary: null },
            description: `You ${match.userAction}d this profile. Waiting for their response.`
          });
          return;
        }

        // Other user acted, current user needs to respond
        if (!match.hasUserActed && match.hasOtherUserActed) {
          if (match.otherUserAction === 'like') {
            // Other user liked, current user needs to respond
            mutualMatches.push({
              ...match,
              category: 'mutual',
              showButtons: true,
              buttonText: { primary: 'Like', secondary: 'Pass' },
              description: 'This person liked you! Do you like them back?'
            });
          } else {
            // Other user passed, current user can still act
            mutualMatches.push({
              ...match,
              category: 'mutual',
              showButtons: true,
              buttonText: { primary: 'Like', secondary: 'Pass' },
              description: 'Your turn to make a choice!'
            });
          }
          return;
        }

        // Both users acted - check for second chance scenarios
        if (match.hasUserActed && match.hasOtherUserActed) {
          // Check if it's a mutual like (shouldn't happen here if chatUnlocked works)
          if (match.userAction === 'like' && match.otherUserAction === 'like') {
            loveMatches.push({
              ...match,
              category: 'love',
              showButtons: false,
              buttonText: null,
              description: 'You both liked each other! Start chatting.'
            });
            return;
          }

          // SECOND CHANCE SCENARIOS
          
          // Scenario 1: Current user passed, other user liked
          if (match.userAction === 'pass' && match.otherUserAction === 'like') {
            // Check if second chance was already offered based on userPosition
            const secondChanceOffered = match.userPosition === 'user1' 
              ? match.user1_second_chance_offered 
              : match.user2_second_chance_offered;
            
            const secondChanceResponse = match.userPosition === 'user1'
              ? match.user1_second_chance_response
              : match.user2_second_chance_response;

            if (!secondChanceOffered) {
              // Offer second chance to current user
              mutualMatches.push({
                ...match,
                category: 'mutual',
                showButtons: true,
                buttonText: { primary: 'Like', secondary: 'Still Pass' },
                description: 'The other person has liked you. Are you sure?',
                isSecondChance: true
              });
            } else if (secondChanceResponse === null) {
              // Second chance was offered but no response yet (shouldn't happen in UI)
              mutualMatches.push({
                ...match,
                category: 'mutual',
                showButtons: true,
                buttonText: { primary: 'Like', secondary: 'Still Pass' },
                description: 'The other person has liked you. Are you sure?',
                isSecondChance: true
              });
            }
            // If secondChanceResponse is 'still_pass', match should be hidden
            // If secondChanceResponse is 'like', match should be in love matches
            return;
          }

          // Scenario 2: Current user liked, other user passed
          if (match.userAction === 'like' && match.otherUserAction === 'pass') {
            // Check if second chance was offered to the other user
            const otherUserSecondChanceOffered = match.userPosition === 'user1'
              ? match.user2_second_chance_offered
              : match.user1_second_chance_offered;

            if (!otherUserSecondChanceOffered) {
              // Waiting for system to offer second chance to other user
              mutualMatches.push({
                ...match,
                category: 'mutual',
                showButtons: false,
                buttonText: { primary: 'Awaiting Reply', secondary: null },
                description: 'Waiting for their final decision...'
              });
            } else {
              // Second chance was offered to other user, waiting for response
              mutualMatches.push({
                ...match,
                category: 'mutual',
                showButtons: false,
                buttonText: { primary: 'Awaiting Reply', secondary: null },
                description: 'Waiting for their final decision...'
              });
            }
            return;
          }

          // Both users passed - match should be hidden/deleted
          if (match.userAction === 'pass' && match.otherUserAction === 'pass') {
            // Don't show this match
            return;
          }
        }
      }
    });

    const categorizedMatches = {
      // All matches for debugging
      allMatches,
      
      // Categorized matches
      oneWayMatches,
      mutualMatches, 
      loveMatches,
      
      // Counts
      totalCount: allMatches.length,
      oneWayCount: oneWayMatches.length,
      mutualCount: mutualMatches.length,
      loveCount: loveMatches.length,
      
      // Legacy compatibility
      matches: allMatches
    };

    return categorizedMatches;

  } catch (error) {
    console.error('❌ Error getting matches:', error);
    return {
      allMatches: [],
      oneWayMatches: [],
      mutualMatches: [],
      loveMatches: [],
      totalCount: 0,
      oneWayCount: 0,
      mutualCount: 0,
      loveCount: 0,
      matches: []
    };
  }
};

const signInUser = async (req, res) => {
  try {
    
    const { email } = req.body;

    // Validate email is provided
    if (!email) {
      return res.status(400).json({
        status: 'error',
        message: 'Email is required'
      });
    }

    // Check if user exists in Firestore
    const usersRef = db.collection('users');
    const snapshot = await usersRef.where('email', '==', email).get();

    if (snapshot.empty) {
      return res.status(200).json({
        status: 'success',
        message: 'User not found',
        data: {
          user: null,
          matches: null
        }
      });
    }

    // User found - get the user document
    const userDoc = snapshot.docs[0];
    const rawUserData = userDoc.data();
    
    // ✅ ADD DEFAULT VALUES FOR MISSING FIELDS
    const userData = {
      ...rawUserData,
      // Ensure tour fields exist with proper defaults
      hasSeenDashboardTour: rawUserData.hasSeenDashboardTour || false,
      tourCompletedAt: rawUserData.tourCompletedAt || null,
      // Ensure PWA fields exist with proper defaults
      isPWAInstalled: rawUserData.isPWAInstalled || false,
      pushNotificationsEnabled: rawUserData.pushNotificationsEnabled || false,
      pwaInstallPromptShown: rawUserData.pwaInstallPromptShown || false,
      pwaInstallPromptDismissed: rawUserData.pwaInstallPromptDismissed || false,
      lastPWAPromptAt: rawUserData.lastPWAPromptAt || null,
      // NEW PWA FIELDS FOR 15-DAY RE-PROMPT LOGIC
      pwaPromptRejectedCount: rawUserData.pwaPromptRejectedCount || 0,
      nextPWAPromptEligibleAt: rawUserData.nextPWAPromptEligibleAt || null,
      pwaPromptAcceptedAt: rawUserData.pwaPromptAcceptedAt || null,
      // Ensure other fields exist too
      showFullProfile: rawUserData.showFullProfile || false,
      showPersonalityScore: rawUserData.showPersonalityScore || false
    };
    
    // CHECK IF USER IS ELIGIBLE FOR PWA RE-PROMPT (15-day logic)
    let shouldShowPWAPrompt = false;
    const now = new Date();
    
    if (!userData.isPWAInstalled && userData.nextPWAPromptEligibleAt) {
      // Convert Firestore timestamp to Date if necessary
      const eligibleDate = userData.nextPWAPromptEligibleAt.toDate ? 
        userData.nextPWAPromptEligibleAt.toDate() : 
        new Date(userData.nextPWAPromptEligibleAt);
      
      if (now >= eligibleDate) {
        shouldShowPWAPrompt = true;
      } else {
        const daysRemaining = Math.ceil((eligibleDate - now) / (1000 * 60 * 60 * 24));
      }
    } else if (!userData.isPWAInstalled && !userData.hasSeenDashboardTour) {
      // First time user who hasn't seen tour yet - will get prompt after tour
    } else if (!userData.isPWAInstalled && userData.hasSeenDashboardTour && !userData.pwaInstallPromptShown) {
      // User completed tour but never saw PWA prompt (edge case)
      shouldShowPWAPrompt = true;
    }
    
    // Add PWA prompt eligibility flag to userData
    userData.shouldShowPWAPrompt = shouldShowPWAPrompt;

    // Get unnotified matches for this user
    const matchData = await getUnnotifiedMatches(userData.id);

    // Return complete user profile including matches and PWA prompt eligibility
    res.status(200).json({
      status: 'success',
      message: 'User found',
      data: {
        user: userData, // ✅ Now includes defaults and PWA prompt eligibility
        matches: matchData
      }
    });

  } catch (error) {
    console.error('❌ Sign in error:', error);
    
    res.status(500).json({
      status: 'error',
      message: 'Sign in failed',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

const verifyEmailToken = async (req, res) => {
  try {
    
    const { token } = req.body;

    // Validate token is provided
    if (!token) {
      return res.status(400).json({
        status: 'error',
        message: 'Token is required'
      });
    }

    // Verify the JWT token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (jwtError) {
      console.error('❌ JWT verification failed:', jwtError.message);
      
      if (jwtError.name === 'TokenExpiredError') {
        return res.status(401).json({
          status: 'error',
          message: 'Email link has expired for your security'
        });
      } else if (jwtError.name === 'JsonWebTokenError') {
        return res.status(401).json({
          status: 'error',
          message: 'Invalid authentication token'
        });
      } else {
        return res.status(401).json({
          status: 'error',
          message: 'Token verification failed'
        });
      }
    }

    // Verify token purpose
    if (decoded.purpose !== 'email_login') {
      console.error('❌ Invalid token purpose:', decoded.purpose);
      return res.status(401).json({
        status: 'error',
        message: 'Invalid token type'
      });
    }

    // Get user from database using user ID from token
    const userRef = db.collection('users').doc(decoded.userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      console.error('❌ User not found in database:', decoded.userId);
      return res.status(404).json({
        status: 'error',
        message: 'User account not found'
      });
    }

    const rawUserData = userDoc.data();

    // Verify email matches the one in the token
    if (rawUserData.email !== decoded.email) {
      console.error('❌ Email mismatch:', {
        tokenEmail: decoded.email,
        userEmail: rawUserData.email
      });
      return res.status(401).json({
        status: 'error',
        message: 'Email verification failed'
      });
    }

    // ✅ ADD DEFAULT VALUES FOR MISSING FIELDS
    const userData = {
      ...rawUserData,
      // Ensure tour fields exist with proper defaults
      hasSeenDashboardTour: rawUserData.hasSeenDashboardTour || false,
      tourCompletedAt: rawUserData.tourCompletedAt || null,
      // Ensure other fields exist too
      isPWAInstalled: rawUserData.isPWAInstalled || false,
      pushNotificationsEnabled: rawUserData.pushNotificationsEnabled || false,
      showFullProfile: rawUserData.showFullProfile || false,
      showPersonalityScore: rawUserData.showPersonalityScore || false
    };


    // Get unnotified matches for this user
    const matchData = await getUnnotifiedMatches(userData.id);

    // Generate new session auth token (longer expiry for user session)
    const sessionToken = jwt.sign(
      { 
        userId: userData.id,
        email: userData.email,
        purpose: 'session'
      }, 
      process.env.JWT_SECRET, 
      { expiresIn: '7d' } // 7 days for session
    );

    // Return complete user data, matches, and session token
    res.status(200).json({
      status: 'success',
      message: 'Email verification successful',
      user: userData, // ✅ Now includes defaults
      matches: matchData,
      authToken: sessionToken
    });

  } catch (error) {
    console.error('❌ Email token verification error:', error);
    
    res.status(500).json({
      status: 'error',
      message: 'Verification failed',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};
const registerUser = async (req, res) => {
  try {
    
    // Extract form data
    const {
      firstName,
      lastName,
      age,
      gender,
      interestedIn,
      city,
      lookingFor,
      relationshipStatus,
      email,
      phone,
      profilePictureSource,
      profilePictureFromGoogle
    } = req.body;

    // Log original values from form

    // Validate required fields
    if (!firstName || !lastName || !age || !gender || !interestedIn || !city || !lookingFor || !relationshipStatus || !email) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing required fields'
      });
    }

    // Get users collection reference
    const usersRef = db.collection('users');

    // Check if user already exists with this email
    const existingUserSnapshot = await usersRef.where('email', '==', email).get();

    if (!existingUserSnapshot.empty) {
      return res.status(409).json({
        status: 'error',
        message: 'An account with this email already exists'
      });
    }

    // Check if phone number already exists (only if phone is provided)
    if (phone && phone.trim() !== '') {
      const existingPhoneSnapshot = await usersRef.where('phone', '==', phone).get();
      
      if (!existingPhoneSnapshot.empty) {
        return res.status(409).json({
          status: 'error',
          message: 'An account with this phone number already exists'
        });
      }
    }

    // Generate user ID
    const userId = uuidv4();

    // Handle profile picture based on source (single photo for registration)
    let profilePictureUrl = null;

    if (profilePictureSource === 'uploaded' && req.files && req.files.profilePicture) {
      const file = req.files.profilePicture[0];
      profilePictureUrl = await azureStorage.uploadImage(file.buffer, file.originalname, userId, 0);
      
    } else if (profilePictureSource === 'google' && profilePictureFromGoogle) {
      profilePictureUrl = await azureStorage.uploadImageFromUrl(profilePictureFromGoogle, userId, 0);
      
    } 

    // Create profile pictures array (compatible with multi-photo system)
    let profilePictures = [];
    if (profilePictureUrl) {
      profilePictures = [{
        url: profilePictureUrl,
        isMain: true,
        order: 0,
        uploadedAt: new Date()
      }];
    }

    // NORMALIZE THE DATA BEFORE SAVING
    const rawUserData = {
      firstName,
      lastName,
      age: parseInt(age),
      gender,
      interestedIn,
      city,
      lookingFor,
      relationshipStatus,
      email,
      phone: phone || null
    };

    const normalizedUserData = normalizeUserData(rawUserData);
    

    // Create user document for Firestore with normalized data
    const userData = {
      id: userId,
      ...normalizedUserData, // Use normalized data
      // New multi-photo system
      profilePictures: profilePictures,
      // Keep legacy field for backward compatibility
      profilePicture: profilePictureUrl,
      profilePictureSource: profilePictureSource || 'none',
      // DEFAULT MATCHING ALGORITHMS
      similarityMatching: true,
      complementaryMatching: false,
      multiDimensionalMatching: false,
      dealBreakerFiltering: false,
      // PRIVACY FIELDS WITH DEFAULT VALUES
      showFullProfile: false,
      showPersonalityScore: false,
      // PWA AND PUSH NOTIFICATION FLAGS WITH DEFAULT VALUES
      isPWAInstalled: false,
      pushNotificationsEnabled: false,
      notificationPermissionDenied: false,
      pushSubscription: null,
      pwaInstallPromptShown: false,
      pwaInstallPromptDismissed: false,
      lastPWAPromptAt: null,
      // NEW PWA FIELDS FOR 15-DAY RE-PROMPT LOGIC
      pwaPromptRejectedCount: 0,
      nextPWAPromptEligibleAt: null,
      pwaPromptAcceptedAt: null,
      // TOUR FIELDS
      hasSeenDashboardTour: false,
      tourCompletedAt: null,
      // EXISTING FIELDS
      createdAt: new Date(),
      updatedAt: new Date(),
      isActive: true,
      isVerified: false
    };

    // Save to Firestore
    await db.collection('users').doc(userId).set(userData);
    

    // Return success response with user data (no matches for new user)
    res.status(201).json({
      status: 'success',
      message: 'User registered successfully',
      data: {
        user: userData,
        matches: {
          matches: [],
          mutualMatches: [],
          oneWayMatches: [],
          totalCount: 0,
          mutualCount: 0,
          oneWayCount: 0
        }
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    
    res.status(500).json({
      status: 'error',
      message: 'Registration failed',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

const updateUserProfile = async (req, res) => {
  try {
    const {
      email,
      firstName,
      lastName,
      age,
      gender,
      interestedIn,
      city,
      lookingFor,
      relationshipStatus,
      phone,
      showFullProfile,
      showPersonalityScore,
      mainPhotoIndex,
      existingPhotos
    } = req.body;

    // Validate required fields
    if (!email) {
      return res.status(400).json({
        status: 'error',
        message: 'Email is required'
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
    const currentUserData = userDoc.data();
    
    // Handle multi-photo upload
    let profilePictures = [];
    let mainProfilePictureUrl = null;

    // Parse existing photos
    let existingPhotosData = [];
    if (existingPhotos) {
      try {
        existingPhotosData = JSON.parse(existingPhotos);
      } catch (parseError) {
        console.warn('⚠️ Failed to parse existing photos:', parseError.message);
      }
    }

    // Upload new photos if provided
    let newPhotos = [];
    if (req.files && Object.keys(req.files).length > 0) {
      newPhotos = await azureStorage.uploadMultipleImages(req.files, userId, existingPhotosData);
    }

    // Combine existing and new photos
    const allPhotos = [...existingPhotosData, ...newPhotos];
    
    // Build final profile pictures array
    const maxPhotos = 5;
    for (let i = 0; i < maxPhotos; i++) {
      const existingPhoto = existingPhotosData.find(photo => photo.index === i);
      const newPhoto = newPhotos.find(photo => photo.index === i);
      
      if (newPhoto) {
        // New photo uploaded for this slot
        profilePictures.push({
          url: newPhoto.url,
          isMain: i === parseInt(mainPhotoIndex || 0),
          order: i,
          uploadedAt: new Date()
        });
      } else if (existingPhoto && existingPhoto.url) {
        // Keep existing photo
        profilePictures.push({
          url: existingPhoto.url,
          isMain: i === parseInt(mainPhotoIndex || 0),
          order: i,
          uploadedAt: new Date() // Update timestamp
        });
      }
    }

    // Set main profile picture URL for backward compatibility
    const mainPhoto = profilePictures.find(photo => photo.isMain);
    mainProfilePictureUrl = mainPhoto ? mainPhoto.url : (profilePictures[0] ? profilePictures[0].url : null);

    // Delete old photos that are no longer used
    if (currentUserData.profilePictures) {
      const currentPhotoUrls = currentUserData.profilePictures.map(photo => photo.url);
      const newPhotoUrls = profilePictures.map(photo => photo.url);
      const photosToDelete = currentPhotoUrls.filter(url => !newPhotoUrls.includes(url));
      
      if (photosToDelete.length > 0) {
        await azureStorage.deleteMultipleImages(photosToDelete);
      }
    }

    // Prepare update data
    const updateData = {
      updatedAt: new Date()
    };

    // Add fields that are provided
    if (firstName !== undefined) updateData.firstName = firstName;
    if (lastName !== undefined) updateData.lastName = lastName;
    if (age !== undefined) updateData.age = parseInt(age);
    if (gender !== undefined) updateData.gender = gender;
    if (interestedIn !== undefined) updateData.interestedIn = interestedIn;
    if (city !== undefined) updateData.city = city;
    if (lookingFor !== undefined) updateData.lookingFor = lookingFor;
    if (relationshipStatus !== undefined) updateData.relationshipStatus = relationshipStatus;
    if (phone !== undefined) updateData.phone = phone;
    if (showFullProfile !== undefined) updateData.showFullProfile = showFullProfile === 'true';
    if (showPersonalityScore !== undefined) updateData.showPersonalityScore = showPersonalityScore === 'true';
    
    // Update photos
    updateData.profilePictures = profilePictures;
    updateData.profilePicture = mainProfilePictureUrl; // Backward compatibility

    // Update user document
    await userDoc.ref.update(updateData);
    
    // Get updated user data
    const updatedUserSnapshot = await userDoc.ref.get();
    const updatedUserData = updatedUserSnapshot.data();

    // Return success response
    res.status(200).json({
      status: 'success',
      message: 'Profile updated successfully',
      data: {
        user: updatedUserData
      }
    });

  } catch (error) {
    console.error('❌ Profile update error:', error);
    
    res.status(500).json({
      status: 'error',
      message: 'Profile update failed',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

const updateMatchSettings = async (req, res) => {
  try {
    
    const {
      email,
      similarityMatching,
      complementaryMatching,
      multiDimensionalMatching,
      dealBreakerFiltering
    } = req.body;

    // Validate required fields
    if (!email) {
      return res.status(400).json({
        status: 'error',
        message: 'Email is required'
      });
    }

    // Validate that exactly one matching algorithm is true
    const matchingAlgorithms = [similarityMatching, complementaryMatching, multiDimensionalMatching, dealBreakerFiltering];
    const activeAlgorithms = matchingAlgorithms.filter(algo => algo === true);
    
    if (activeAlgorithms.length !== 1) {
      return res.status(400).json({
        status: 'error',
        message: 'Exactly one matching algorithm must be selected'
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
    
    // Prepare update data
    const updateData = {
      similarityMatching: similarityMatching || false,
      complementaryMatching: complementaryMatching || false,
      multiDimensionalMatching: multiDimensionalMatching || false,
      dealBreakerFiltering: dealBreakerFiltering || false,
      updatedAt: new Date()
    };

    // Update user document
    await userDoc.ref.update(updateData);
    
    // Get updated user data
    const updatedUserSnapshot = await userDoc.ref.get();
    const updatedUserData = updatedUserSnapshot.data();

    // Return success response
    res.status(200).json({
      status: 'success',
      message: 'Match settings updated successfully',
      data: {
        user: updatedUserData
      }
    });

  } catch (error) {
    console.error('❌ Match settings update error:', error);
    
    res.status(500).json({
      status: 'error',
      message: 'Match settings update failed',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

const updateQuestions = async (req, res) => {
  try {

    const { email, responses } = req.body;

    // Validate required fields
    if (!email || !responses || !Array.isArray(responses)) {
      console.error('❌ Validation failed:', { email: !!email, responses: !!responses, isArray: Array.isArray(responses) });
      return res.status(400).json({
        status: 'error',
        message: 'Email and responses array are required'
      });
    }

    // Find user by email
    const usersRef = db.collection('users');
    const snapshot = await usersRef.where('email', '==', email).get();

    if (snapshot.empty) {
      console.error('❌ User not found for email:', email);
      return res.status(404).json({
        status: 'error',
        message: 'User not found'
      });
    }

    const userDoc = snapshot.docs[0];
    const userId = userDoc.id;
    const currentUserData = userDoc.data();

    // Step 1: Save updated responses to database
    // Convert responses array back to answers object format for database consistency
    // FIXED: Using 'question' prefix instead of 'q' to match frontend expectations
    const answersObject = {};
    responses.forEach((response) => {
      answersObject[`question${response.questionId}`] = {
        questionId: response.questionId,
        answer: response.answer,
        answeredAt: new Date()
      };
    });

    const updateData = {
      answers: answersObject,
      responses: responses, // Also save in responses format for compatibility
      updatedAt: new Date()
    };

    await userDoc.ref.update(updateData);

    // Step 2: Prepare data for Claude API
    const questionsForAnalysis = responses.map((response) => ({
      question: response.question,
      answer: response.answer
    }));

    // Get previous personality analysis for incremental update
    const previousAnalysis = currentUserData.personalityAnalysis || null;

    // Step 3: Send to Claude API with incremental update prompt
    const claudePrompt = previousAnalysis 
      ? `I need you to update an existing personality analysis based on revised responses to personality questions.

PREVIOUS PERSONALITY ANALYSIS:
${JSON.stringify(previousAnalysis, null, 2)}

UPDATED RESPONSES:
${questionsForAnalysis.map((q, i) => `${i + 1}. ${q.question}\nAnswer: ${q.answer}`).join('\n\n')}

Please provide an UPDATED personality analysis that evolves from the previous analysis while incorporating these revised responses. Maintain consistency with the previous analysis where responses haven't significantly changed, but update relevant aspects based on the new information.

Return a JSON object with this exact structure:
{
  "corePersonality": {
    "primaryTraits": ["trait1", "trait2", "trait3"],
    "strengths": ["strength1", "strength2", "strength3"],
    "preferences": ["preference1", "preference2", "preference3"]
  },
  "relationshipStyle": {
    "attachmentStyle": "secure/anxious/avoidant/disorganized",
    "communicationStyle": "description",
    "conflictResolution": "description"
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
    "idealPartnerType": "description",
    "compatibilityPredictors": ["predictor1", "predictor2"],
    "relationshipAdvice": "advice text"
  }
}`
      : `Based on the following personality assessment responses, provide a comprehensive personality analysis for dating compatibility.

RESPONSES:
${questionsForAnalysis.map((q, i) => `${i + 1}. ${q.question}\nAnswer: ${q.answer}`).join('\n\n')}

Return a JSON object with this exact structure:
{
  "corePersonality": {
    "primaryTraits": ["trait1", "trait2", "trait3"],
    "strengths": ["strength1", "strength2", "strength3"],
    "preferences": ["preference1", "preference2", "preference3"]
  },
  "relationshipStyle": {
    "attachmentStyle": "secure/anxious/avoidant/disorganized",
    "communicationStyle": "description",
    "conflictResolution": "description"
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
    "idealPartnerType": "description",
    "compatibilityPredictors": ["predictor1", "predictor2"],
    "relationshipAdvice": "advice text"
  }
}`;

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 2000,
        temperature: 0.7,
        messages: [
          {
            role: 'user',
            content: claudePrompt
          }
        ]
      })
    });

    if (!claudeResponse.ok) {
      const errorText = await claudeResponse.text();
      console.error('❌ Claude API error:', claudeResponse.status, errorText);
      throw new Error(`Claude API error: ${claudeResponse.status} - ${errorText}`);
    }

    const claudeData = await claudeResponse.json();
    
    const analysisText = claudeData.content[0].text;
    
    // Step 4: Parse Claude's response
    let personalityAnalysis;
    try {
      const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        personalityAnalysis = JSON.parse(jsonMatch[0]);
      } else {
        console.error('❌ No JSON found in Claude response');
        throw new Error('No JSON found in Claude response');
      }
    } catch (parseError) {
      console.error('❌ Failed to parse Claude response:', parseError);
      console.error('❌ Raw response:', analysisText);
      throw new Error('Invalid personality analysis format from Claude');
    }

    // Step 5: Save analysis to database
    const finalUpdateData = {
      answers: answersObject,
      responses: responses,
      personalityAnalysis: personalityAnalysis,
      isAnalysisComplete: true,
      analysisCompletedAt: new Date(),
      updatedAt: new Date()
    };

    await userDoc.ref.update(finalUpdateData);

    // Get updated user data
    const updatedUserSnapshot = await userDoc.ref.get();
    const updatedUserData = updatedUserSnapshot.data();


    // Return success response
    res.status(200).json({
      status: 'success',
      message: 'Questions updated and personality re-analyzed successfully',
      data: {
        user: updatedUserData
      }
    });

  } catch (error) {
    console.error('❌ Questions update error:', error);
    console.error('❌ Error stack:', error.stack);
    
    res.status(500).json({
      status: 'error',
      message: 'Questions update failed',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

const updateBio = async (req, res) => {
  try {
    const { email, bioData } = req.body;

    // Validate required fields
    if (!email || !bioData) {
      console.error('❌ Validation failed:', { email: !!email, bioData: !!bioData });
      return res.status(400).json({
        status: 'error',
        message: 'Email and bioData are required'
      });
    }

    // Find user by email
    const usersRef = db.collection('users');
    const snapshot = await usersRef.where('email', '==', email).get();

    if (snapshot.empty) {
      console.error('❌ User not found for email:', email);
      return res.status(404).json({
        status: 'error',
        message: 'User not found'
      });
    }

    const userDoc = snapshot.docs[0];
    const userId = userDoc.id;
    const currentUserData = userDoc.data();

    // Prepare update data
    const updateData = {
      bioData: bioData,
      bioUpdatedAt: new Date(),
      updatedAt: new Date()
    };

    // Update user document
    await userDoc.ref.update(updateData);

    // Get updated user data
    const updatedUserSnapshot = await userDoc.ref.get();
    const updatedUserData = updatedUserSnapshot.data();


    // Return success response
    res.status(200).json({
      status: 'success',
      message: 'Bio data updated successfully',
      data: {
        user: updatedUserData,
        bioData: bioData,
        updatedAt: updateData.bioUpdatedAt
      }
    });

  } catch (error) {
    console.error('❌ Bio update error:', error);
    console.error('❌ Error stack:', error.stack);
    
    res.status(500).json({
      status: 'error',
      message: 'Bio update failed',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

const updatePWAStatus = async (req, res) => {
  try {

    const { 
      email, 
      isPWAInstalled, 
      pushSubscription, 
      pushNotificationsEnabled,
      pwaPromptAction, // New field: 'accepted', 'rejected', 'dismissed'
      pwaPromptShown // New field: true when prompt is shown
    } = req.body;

    // Validate required fields
    if (!email) {
      return res.status(400).json({
        status: 'error',
        message: 'Email is required'
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
    const currentUserData = userDoc.data();
    

    // Prepare update data
    const updateData = {
      updatedAt: new Date()
    };

    // Handle PWA prompt shown
    if (pwaPromptShown !== undefined && pwaPromptShown === true) {
      updateData.pwaInstallPromptShown = true;
      updateData.lastPWAPromptAt = new Date();
    }

    // Handle PWA prompt action (accepted, rejected, dismissed)
    if (pwaPromptAction !== undefined) {
      
      if (pwaPromptAction === 'accepted') {
        updateData.pwaPromptAcceptedAt = new Date();
        updateData.pwaInstallPromptDismissed = false;
        // Reset rejection count since user accepted
        updateData.pwaPromptRejectedCount = 0;
        updateData.nextPWAPromptEligibleAt = null;
        
      } else if (pwaPromptAction === 'rejected' || pwaPromptAction === 'dismissed') {
        updateData.pwaInstallPromptDismissed = true;
        
        // Increment rejection count
        const currentRejectionCount = currentUserData.pwaPromptRejectedCount || 0;
        updateData.pwaPromptRejectedCount = currentRejectionCount + 1;
        
        // Calculate next eligible date (15 days from now)
        const nextEligibleDate = new Date();
        nextEligibleDate.setDate(nextEligibleDate.getDate() + 15);
        updateData.nextPWAPromptEligibleAt = nextEligibleDate;
        
        // Optional: Stop prompting after certain number of rejections
      }
    }

    // Update PWA installation status
    if (isPWAInstalled !== undefined) {
      updateData.isPWAInstalled = isPWAInstalled;
      if (isPWAInstalled) {
        updateData.pwaInstalledAt = new Date();
        // Clear rejection tracking since PWA is now installed
        updateData.pwaPromptRejectedCount = 0;
        updateData.nextPWAPromptEligibleAt = null;
        updateData.pwaInstallPromptDismissed = false;
      }
    }

    // Update push notification settings
    if (pushNotificationsEnabled !== undefined) {
      updateData.pushNotificationsEnabled = pushNotificationsEnabled;
      if (pushNotificationsEnabled === false) {
        updateData.notificationPermissionDenied = true;
      } else {
        updateData.notificationPermissionDenied = false;
      }
    }

    // Update push subscription data
    if (pushSubscription !== undefined) {
      updateData.pushSubscription = pushSubscription;
      if (pushSubscription) {
        updateData.pushSubscriptionUpdatedAt = new Date();
      }
    }

    // Update user document
    await userDoc.ref.update(updateData);

    // Get updated user data
    const updatedUserSnapshot = await userDoc.ref.get();
    const updatedUserData = updatedUserSnapshot.data();

    // Add shouldShowPWAPrompt flag for frontend
    const now = new Date();
    let shouldShowPWAPrompt = false;
    
    if (!updatedUserData.isPWAInstalled && updatedUserData.nextPWAPromptEligibleAt) {
      const eligibleDate = updatedUserData.nextPWAPromptEligibleAt.toDate ? 
        updatedUserData.nextPWAPromptEligibleAt.toDate() : 
        new Date(updatedUserData.nextPWAPromptEligibleAt);
      
      if (now >= eligibleDate) {
        shouldShowPWAPrompt = true;
      }
    }
    
    updatedUserData.shouldShowPWAPrompt = shouldShowPWAPrompt;

    // Return success response
    res.status(200).json({
      status: 'success',
      message: 'PWA status updated successfully',
      data: {
        user: updatedUserData
      }
    });

  } catch (error) {
    console.error('❌ PWA status update error:', error);
    
    res.status(500).json({
      status: 'error',
      message: 'PWA status update failed',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

const updateTourStatus = async (req, res) => {
  try {
    
    const { email, hasSeenDashboardTour, tourCompletedAt } = req.body;

    if (!email) {
      return res.status(400).json({
        status: 'error',
        message: 'Email is required'
      });
    }

    // ✅ ADD VALIDATION FOR TOUR STATUS

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
    const currentUserData = userDoc.data();
    
    // ✅ ENSURE PROPER BOOLEAN VALUES
    const updateData = {
      updatedAt: new Date()
    };

    // Only update fields that are explicitly provided
    if (hasSeenDashboardTour !== undefined) {
      updateData.hasSeenDashboardTour = Boolean(hasSeenDashboardTour); // Ensure boolean
    }

    if (tourCompletedAt !== undefined) {
      updateData.tourCompletedAt = tourCompletedAt;
    }

    await userDoc.ref.update(updateData);
    
    // Get updated user data to verify the change
    const updatedUserSnapshot = await userDoc.ref.get();
    const updatedUserData = updatedUserSnapshot.data();
    

    res.status(200).json({
      status: 'success',
      message: 'Tour status updated successfully',
      data: {
        user: updatedUserData
      }
    });

  } catch (error) {
    console.error('❌ Tour status update error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Tour status update failed',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

module.exports = {
  signInUser,
  verifyEmailToken,
  registerUser,
  updateUserProfile,
  updateMatchSettings,
  updateQuestions,
  updateBio,
  updatePWAStatus,
  updateTourStatus
};
