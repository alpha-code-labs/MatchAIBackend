const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin SDK
const initializeFirebase = () => {
  try {
    // Check if Firebase is already initialized
    if (admin.apps.length === 0) {
      const serviceAccountPath = path.join(process.cwd(), process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH);
      
      admin.initializeApp({
        credential: admin.credential.cert(require(serviceAccountPath)),
        databaseURL: process.env.FIREBASE_DATABASE_URL // Add this line
      });
      
      console.log('✅ Firebase Admin initialized successfully');
    }
    
    return admin;
  } catch (error) {
    console.error('❌ Firebase initialization error:', error);
    throw error;
  }
};

// Initialize Firebase
const firebaseAdmin = initializeFirebase();

// Get Firestore database instance
const db = firebaseAdmin.firestore();

// Get Firebase Auth instance
const auth = firebaseAdmin.auth();

const realtimeDb = firebaseAdmin.database();

module.exports = {
  admin: firebaseAdmin,
  db,
  auth,
  realtimeDb
};