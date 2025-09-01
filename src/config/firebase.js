const admin = require('firebase-admin');

// Initialize Firebase Admin SDK
const initializeFirebase = () => {
  try {
    // Check if Firebase is already initialized
    if (admin.apps.length === 0) {
      let serviceAccount;
      
      // Check if running in production (Azure)
      if (process.env.NODE_ENV === 'production' && process.env.FIREBASE_SERVICE_ACCOUNT) {
        // In production, parse from environment variable
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      } else {
        // In development, use the file
        const path = require('path');
        const serviceAccountPath = path.join(process.cwd(), process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH);
        serviceAccount = require(serviceAccountPath);
      }
      
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: process.env.FIREBASE_DATABASE_URL
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
