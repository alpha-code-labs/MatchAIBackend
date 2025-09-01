const { db, realtimeDb } = require('../config/firebase');
const { FieldValue } = require('firebase-admin/firestore');

/**
 * Helper function to remove undefined values from object (Firebase doesn't allow undefined)
 */
const removeUndefinedValues = (obj) => {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        // Recursively clean nested objects
        const cleanedNested = removeUndefinedValues(value);
        if (Object.keys(cleanedNested).length > 0) {
          result[key] = cleanedNested;
        }
      } else {
        result[key] = value;
      }
    }
  }
  return result;
};

/**
 * Helper function to send real-time match updates to both users
 */
const sendMatchUpdate = async (matchId, matchData, updateType) => {
  try {
    const user1Id = matchData.user1_id;
    const user2Id = matchData.user2_id; 
    const updatePayload = {
      matchId,
      updateType, // 'status_change', 'love_match', 'second_chance', 'match_removed'
      newStatus: matchData.match_status || 'pending',
      chatUnlocked: matchData.chat_unlocked || false,
      timestamp: Date.now(),
      matchData: {
        // Only send essential data to avoid large payloads, and ensure no undefined values
        match_type: matchData.match_type,
        user1_action: matchData.user1_action || null,
        user2_action: matchData.user2_action || null,
        chat_unlocked: matchData.chat_unlocked || false,
        match_status: matchData.match_status || 'pending',
        user1_second_chance_offered: matchData.user1_second_chance_offered || false,
        user2_second_chance_offered: matchData.user2_second_chance_offered || false
      }
    };

    // Clean the payload to remove any undefined values
    const cleanPayload = removeUndefinedValues(updatePayload);

    // Send update to both users
    const updates = {};
    updates[`match_updates/${user1Id}/${matchId}`] = cleanPayload;
    updates[`match_updates/${user2Id}/${matchId}`] = cleanPayload;    
    await realtimeDb.ref().update(updates);    
    // Verify the update was written
    const verifyRef = realtimeDb.ref(`match_updates/${user1Id}/${matchId}`);
    const verifySnapshot = await verifyRef.once('value'); 
  } catch (error) {
    console.error('❌ Error sending real-time match update:', error);
    console.error('❌ Error details:', error.message);
    console.error('❌ Error stack:', error.stack);
    // Don't throw error - this shouldn't break the main functionality
  }
};

/**
 * Helper function to remove match update (for cleanup)
 */
const removeMatchUpdate = async (matchId, user1Id, user2Id) => {
  try {
    const updates = {};
    updates[`match_updates/${user1Id}/${matchId}`] = null;
    updates[`match_updates/${user2Id}/${matchId}`] = null;
    await realtimeDb.ref().update(updates);    
  } catch (error) {
    console.error('❌ Error removing match update:', error);
    // Don't throw error - this shouldn't break the main functionality
  }
};

/**
 * Express interest in a one-way match
 * Only for user1 in one_way_interest matches
 */
const expressInterest = async (req, res) => {
  try {
    const { matchId, userId } = req.body;

    if (!matchId || !userId) {
      return res.status(400).json({
        status: 'error',
        message: 'Match ID and User ID are required'
      });
    }

    // Get the match document
    const matchRef = db.collection('matches').doc(matchId);
    const matchDoc = await matchRef.get();

    if (!matchDoc.exists) {
      return res.status(404).json({
        status: 'error',
        message: 'Match not found'
      });
    }

    const matchData = matchDoc.data();

    // Verify this is a one-way match and user is user1
    if (matchData.match_type !== 'one_way_interest') {
      return res.status(400).json({
        status: 'error',
        message: 'This action is only for one-way matches'
      });
    }

    if (matchData.user1_id !== userId) {
      return res.status(403).json({
        status: 'error',
        message: 'You cannot express interest in this match'
      });
    }

    // Check if interest already expressed
    if (matchData.user1_expressed_interest) {
      return res.status(400).json({
        status: 'error',
        message: 'Interest already expressed'
      });
    }

    // Update match to express interest
    const updateData = {
      user1_expressed_interest: true,
      visible_to_user2: true, // Now user2 can see this match
      user2_notified_of_interest: true,
      interest_expressed_at: FieldValue.serverTimestamp(),
      last_action_by: userId,
      last_action_at: FieldValue.serverTimestamp(),
      total_interactions: FieldValue.increment(1),
      // NEW: Mark that user2 should receive like email
      // interest_email_pending_user2: true
      // NEW: Mark that user2 should receive notification
      notification_pending_user2: true
    };

    await matchRef.update(updateData);
    // Get updated match data
    const updatedMatchDoc = await matchRef.get();
    const updatedMatchData = updatedMatchDoc.data();

    // 🚀 NEW: Send real-time update
    await sendMatchUpdate(matchId, updatedMatchData, 'status_change');

    res.status(200).json({
      status: 'success',
      message: 'Interest expressed successfully',
      data: {
        matchId: matchId,
        updatedMatch: updatedMatchData
      }
    });

  } catch (error) {
    console.error('❌ Express interest error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to express interest',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

/**
 * Accept interest from a one-way match
 * Only for user2 after user1 has expressed interest
 */
const acceptInterest = async (req, res) => {
  try {
    const { matchId, userId } = req.body;

    if (!matchId || !userId) {
      return res.status(400).json({
        status: 'error',
        message: 'Match ID and User ID are required'
      });
    }

    // Get the match document
    const matchRef = db.collection('matches').doc(matchId);
    const matchDoc = await matchRef.get();

    if (!matchDoc.exists) {
      return res.status(404).json({
        status: 'error',
        message: 'Match not found'
      });
    }

    const matchData = matchDoc.data();

    // Verify this is a one-way match and user is user2
    if (matchData.match_type !== 'one_way_interest') {
      return res.status(400).json({
        status: 'error',
        message: 'This action is only for one-way matches'
      });
    }

    if (matchData.user2_id !== userId) {
      return res.status(403).json({
        status: 'error',
        message: 'You cannot accept interest in this match'
      });
    }

    // Verify user1 has expressed interest
    if (!matchData.user1_expressed_interest) {
      return res.status(400).json({
        status: 'error',
        message: 'No interest to accept'
      });
    }

    // Update match to create a love match
    const updateData = {
      user2_action: 'like',
      chat_unlocked: true, // This makes it a love match
      match_status: 'love',
      interest_responded_at: FieldValue.serverTimestamp(),
      moved_to_love_at: FieldValue.serverTimestamp(),
      last_action_by: userId,
      last_action_at: FieldValue.serverTimestamp(),
      total_interactions: FieldValue.increment(1),
      // NEW: Mark that both users should receive love emails
      // love_email_pending_user1: true,
      // love_email_pending_user2: true
      // NEW: Mark that both users should receive notification
      notification_pending_user1: true,
      notification_pending_user2: true
    };

    await matchRef.update(updateData);
    // Get updated match data
    const updatedMatchDoc = await matchRef.get();
    const updatedMatchData = updatedMatchDoc.data();

    // 🚀 NEW: Send real-time update for love match
    await sendMatchUpdate(matchId, updatedMatchData, 'love_match');

    res.status(200).json({
      status: 'success',
      message: 'Interest accepted - It\'s a match!',
      data: {
        matchId: matchId,
        isLoveMatch: true,
        updatedMatch: updatedMatchData
      }
    });

  } catch (error) {
    console.error('❌ Accept interest error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to accept interest',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

/**
 * Like a mutual match
 * Handles both initial likes and second chance likes
 */
const likeMatch = async (req, res) => {
  try {
    const { matchId, userId, isSecondChance = false } = req.body;

    if (!matchId || !userId) {
      return res.status(400).json({
        status: 'error',
        message: 'Match ID and User ID are required'
      });
    }

    // Get the match document
    const matchRef = db.collection('matches').doc(matchId);
    const matchDoc = await matchRef.get();

    if (!matchDoc.exists) {
      return res.status(404).json({
        status: 'error',
        message: 'Match not found'
      });
    }

    const matchData = matchDoc.data();

    // Verify this is a mutual match
    if (matchData.match_type !== 'mutual_algorithm') {
      return res.status(400).json({
        status: 'error',
        message: 'This action is only for mutual matches'
      });
    }

    // Determine user position
    const isUser1 = matchData.user1_id === userId;
    const isUser2 = matchData.user2_id === userId;

    if (!isUser1 && !isUser2) {
      return res.status(403).json({
        status: 'error',
        message: 'You are not part of this match'
      });
    }

    let updateData = {
      last_action_by: userId,
      last_action_at: FieldValue.serverTimestamp(),
      total_interactions: FieldValue.increment(1)
    };

    let isLoveMatch = false;
    let secondChanceOffered = false;

    // Handle second chance response
    if (isSecondChance) {
      if (isUser1) {
        updateData.user1_second_chance_response = 'like';
        updateData.user1_action = 'like';
      } else {
        updateData.user2_second_chance_response = 'like';
        updateData.user2_action = 'like';
      }
      
      // This creates a love match after second chance
      updateData.chat_unlocked = true;
      updateData.match_status = 'love';
      updateData.moved_to_love_at = FieldValue.serverTimestamp();
      // NEW: Mark that both users should receive love emails
      // updateData.love_email_pending_user1 = true;
      // updateData.love_email_pending_user2 = true;
      // NEW: Mark that both users should receive notification
      updateData.notification_pending_user1 = true;
      updateData.notification_pending_user2 = true;
      isLoveMatch = true;      
    } else {
      // Regular like action
      if (isUser1) {
        updateData.user1_action = 'like';
        // NEW: Mark that user2 should receive like email
        // updateData.like_email_pending_user2 = true;
        // NEW: Mark that user2 should receive notification
        updateData.notification_pending_user2 = true;        
        // Check if user2 already liked
        if (matchData.user2_action === 'like') {
          // Both liked - create love match
          updateData.chat_unlocked = true;
          updateData.match_status = 'love';
          updateData.moved_to_love_at = FieldValue.serverTimestamp();
          // NEW: Mark that both users should receive love emails
          // updateData.love_email_pending_user1 = true;
          // updateData.love_email_pending_user2 = true;
          // NEW: Mark that both users should receive notification
          updateData.notification_pending_user1 = true;
          updateData.notification_pending_user2 = true;
          isLoveMatch = true;
        } else if (matchData.user2_action === 'pass') {
          // User2 passed, user1 likes - user2 should get second chance
          updateData.user2_second_chance_offered = true;
          secondChanceOffered = true;
        }
      } else {
        updateData.user2_action = 'like';
        // NEW: Mark that user1 should receive like email
        // updateData.like_email_pending_user1 = true;
        // NEW: Mark that user1 should receive notification
        updateData.notification_pending_user1 = true;
        // Check if user1 already liked
        if (matchData.user1_action === 'like') {
          // Both liked - create love match
          updateData.chat_unlocked = true;
          updateData.match_status = 'love';
          updateData.moved_to_love_at = FieldValue.serverTimestamp();
          // NEW: Mark that both users should receive love emails
          // updateData.love_email_pending_user1 = true;
          // updateData.love_email_pending_user2 = true;
          // NEW: Mark that both users should receive notification
          updateData.notification_pending_user1 = true;
          updateData.notification_pending_user2 = true;
          isLoveMatch = true;
        } else if (matchData.user1_action === 'pass') {
          // User1 passed, user2 likes - user1 should get second chance
          updateData.user1_second_chance_offered = true;
          secondChanceOffered = true;
        }
      }
    }

    await matchRef.update(updateData);

    // Get updated match data
    const updatedMatchDoc = await matchRef.get();
    const updatedMatchData = updatedMatchDoc.data();

    // 🚀 NEW: Send real-time update
    const updateType = isLoveMatch ? 'love_match' : (secondChanceOffered ? 'second_chance' : 'status_change');
    await sendMatchUpdate(matchId, updatedMatchData, updateType);

    res.status(200).json({
      status: 'success',
      message: updatedMatchData.chat_unlocked ? 'It\'s a match!' : 'Like recorded',
      data: {
        matchId: matchId,
        isLoveMatch: updatedMatchData.chat_unlocked,
        secondChanceOffered: updateData.user1_second_chance_offered || updateData.user2_second_chance_offered || false,
        updatedMatch: updatedMatchData
      }
    });

  } catch (error) {
    console.error('❌ Like match error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to like match',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

/**
 * Pass on a match
 * Handles one-way passes, mutual passes, and second chance "still pass"
 */
const passMatch = async (req, res) => {
  try {
    const { matchId, userId, isSecondChance = false } = req.body;

    if (!matchId || !userId) {
      return res.status(400).json({
        status: 'error',
        message: 'Match ID and User ID are required'
      });
    }

    // Get the match document
    const matchRef = db.collection('matches').doc(matchId);
    const matchDoc = await matchRef.get();

    if (!matchDoc.exists) {
      return res.status(404).json({
        status: 'error',
        message: 'Match not found'
      });
    }

    const matchData = matchDoc.data();
    
    // Determine user position
    const isUser1 = matchData.user1_id === userId;
    const isUser2 = matchData.user2_id === userId;

    if (!isUser1 && !isUser2) {
      return res.status(403).json({
        status: 'error',
        message: 'You are not part of this match'
      });
    }

    let updateData = {
      last_action_by: userId,
      last_action_at: FieldValue.serverTimestamp(),
      total_interactions: FieldValue.increment(1)
    };

    let shouldDelete = false;
    let secondChanceOffered = false;

    // Handle one-way match pass
    if (matchData.match_type === 'one_way_interest') {
      if (isUser1 && !matchData.user1_expressed_interest) {
        // User1 passes without expressing interest
        updateData.user1_action = 'pass';
        updateData.visible_to_user1 = false;
        shouldDelete = true;
      } else if (isUser2 && matchData.user1_expressed_interest) {
        // User2 rejects after user1 expressed interest
        updateData.user2_action = 'pass';
        updateData.interest_responded_at = FieldValue.serverTimestamp();
        shouldDelete = true;
      }
    }
    
    // Handle mutual match pass
    else if (matchData.match_type === 'mutual_algorithm') {
      if (isSecondChance) {
        // "Still Pass" after second chance
        if (isUser1) {
          updateData.user1_second_chance_response = 'still_pass';
          updateData.user1_action = 'pass';
        } else {
          updateData.user2_second_chance_response = 'still_pass';
          updateData.user2_action = 'pass';
        }
        shouldDelete = true;
      } else {
        // Regular pass action
        if (isUser1) {
          updateData.user1_action = 'pass';
          
          // Check if user2 already passed
          if (matchData.user2_action === 'pass') {
            // Both passed - delete match
            shouldDelete = true;
          } else if (matchData.user2_action === 'like') {
            // User2 liked, user1 passes - user1 should get second chance
            updateData.user1_second_chance_offered = true;
            secondChanceOffered = true;
          }
        } else {
          updateData.user2_action = 'pass';
          
          // Check if user1 already passed
          if (matchData.user1_action === 'pass') {
            // Both passed - delete match
            shouldDelete = true;
          } else if (matchData.user1_action === 'like') {
            // User1 liked, user2 passes - user2 should get second chance
            updateData.user2_second_chance_offered = true;
            secondChanceOffered = true;
          }
        }
      }
    }

    // Handle deletion
    if (shouldDelete) {
      updateData.match_status = 'rejected';
      updateData.deleted_at = FieldValue.serverTimestamp();
      updateData.deleted_reason = isSecondChance ? 'second_chance_rejected' : 'both_passed';
      updateData.visible_to_user1 = false;
      updateData.visible_to_user2 = false;
    }

    await matchRef.update(updateData);

    // Get updated match data
    const updatedMatchDoc = await matchRef.get();
    const updatedMatchData = updatedMatchDoc.data();

    // 🚀 NEW: Send real-time update
    if (shouldDelete) {
      // For deleted matches, send removal update then clean up
      await sendMatchUpdate(matchId, updatedMatchData, 'match_removed');
      // Clean up the real-time update after a short delay
      setTimeout(async () => {
        await removeMatchUpdate(matchId, matchData.user1_id, matchData.user2_id);
      }, 2000);
    } else {
      // For other status changes
      const updateType = secondChanceOffered ? 'second_chance' : 'status_change';
      await sendMatchUpdate(matchId, updatedMatchData, updateType);
    }

    res.status(200).json({
      status: 'success',
      message: shouldDelete ? 'Match removed' : 'Pass recorded',
      data: {
        matchId: matchId,
        isDeleted: shouldDelete,
        secondChanceOffered: updateData.user1_second_chance_offered || updateData.user2_second_chance_offered || false,
        updatedMatch: updatedMatchData
      }
    });

  } catch (error) {
    console.error('❌ Pass match error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to pass match',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

/**
 * Get match details
 * Useful for refreshing match state after actions
 */
const getMatchDetails = async (req, res) => {
  try {
    const { matchId, userId } = req.query;

    if (!matchId || !userId) {
      return res.status(400).json({
        status: 'error',
        message: 'Match ID and User ID are required'
      });
    }

    // Get the match document
    const matchRef = db.collection('matches').doc(matchId);
    const matchDoc = await matchRef.get();

    if (!matchDoc.exists) {
      return res.status(404).json({
        status: 'error',
        message: 'Match not found'
      });
    }

    const matchData = matchDoc.data();

    // Verify user is part of this match
    if (matchData.user1_id !== userId && matchData.user2_id !== userId) {
      return res.status(403).json({
        status: 'error',
        message: 'You are not authorized to view this match'
      });
    }

    // Check visibility
    const isUser1 = matchData.user1_id === userId;
    if ((isUser1 && !matchData.visible_to_user1) || (!isUser1 && !matchData.visible_to_user2)) {
      return res.status(404).json({
        status: 'error',
        message: 'Match not found'
      });
    }

    res.status(200).json({
      status: 'success',
      data: {
        match: matchData,
        userPosition: isUser1 ? 'user1' : 'user2'
      }
    });

  } catch (error) {
    console.error('❌ Get match details error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get match details',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

module.exports = {
  expressInterest,
  acceptInterest,
  likeMatch,
  passMatch,
  getMatchDetails
};