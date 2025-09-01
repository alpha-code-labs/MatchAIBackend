const admin = require('firebase-admin');

const initializeFirebase = () => {
  console.log('🔍 Starting Firebase initialization...');
  console.log('NODE_ENV:', process.env.NODE_ENV);
  console.log('Has FIREBASE_SERVICE_ACCOUNT env:', !!process.env.FIREBASE_SERVICE_ACCOUNT);
  console.log('Has FIREBASE_DATABASE_URL:', !!process.env.FIREBASE_DATABASE_URL);
  console.log('Has FIREBASE_SERVICE_ACCOUNT_KEY_PATH:', !!process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH);
  
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    console.log('FIREBASE_SERVICE_ACCOUNT length:', process.env.FIREBASE_SERVICE_ACCOUNT.length);
    console.log('First 100 chars:', process.env.FIREBASE_SERVICE_ACCOUNT.substring(0, 100));
    console.log('Last 50 chars:', process.env.FIREBASE_SERVICE_ACCOUNT.slice(-50));
  }
  
  try {
    // Check if Firebase is already initialized
    if (admin.apps.length === 0) {
      console.log('📝 No existing Firebase apps, proceeding with initialization...');
      let serviceAccount;
      
      // Check if running in production (Azure)
      if (process.env.NODE_ENV === 'production' && process.env.FIREBASE_SERVICE_ACCOUNT) {
        console.log('🔄 Production mode: Using environment variable for Firebase credentials');
        
        try {
          // Check if it's already an object (shouldn't be, but just in case)
          if (typeof process.env.FIREBASE_SERVICE_ACCOUNT === 'object') {
            console.log('⚠️ FIREBASE_SERVICE_ACCOUNT is already an object');
            serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
          } else {
            console.log('📋 Attempting to parse FIREBASE_SERVICE_ACCOUNT JSON string...');
            serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
            console.log('✅ Successfully parsed Firebase service account JSON');
          }
          
          // Validate the parsed object
          console.log('Validating service account object:');
          console.log('- Has type:', !!serviceAccount.type);
          console.log('- Has project_id:', !!serviceAccount.project_id);
          console.log('- Has private_key:', !!serviceAccount.private_key);
          console.log('- Has client_email:', !!serviceAccount.client_email);
          console.log('- Project ID:', serviceAccount.project_id);
          console.log('- Client email:', serviceAccount.client_email);
          
        } catch (parseError) {
          console.error('❌ Failed to parse FIREBASE_SERVICE_ACCOUNT:');
          console.error('Parse error message:', parseError.message);
          console.error('Parse error stack:', parseError.stack);
          
          // Log the raw value to see what's wrong
          console.error('Raw FIREBASE_SERVICE_ACCOUNT value (first 500 chars):');
          console.error(process.env.FIREBASE_SERVICE_ACCOUNT?.substring(0, 500));
          
          throw parseError;
        }
      } else {
        console.log('🔄 Development mode: Using file-based Firebase credentials');
        console.log('Current working directory:', process.cwd());
        
        const path = require('path');
        const serviceAccountPath = path.join(process.cwd(), process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH);
        console.log('Looking for service account file at:', serviceAccountPath);
        
        try {
          serviceAccount = require(serviceAccountPath);
          console.log('✅ Successfully loaded service account from file');
        } catch (fileError) {
          console.error('❌ Failed to load service account file:', fileError.message);
          throw fileError;
        }
      }
      
      console.log('🔄 Initializing Firebase Admin with credentials...');
      console.log('Database URL:', process.env.FIREBASE_DATABASE_URL);
      
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: process.env.FIREBASE_DATABASE_URL
      });
      
      console.log('✅ Firebase Admin initialized successfully');
    } else {
      console.log('ℹ️ Firebase already initialized, skipping...');
    }
    
    return admin;
  } catch (error) {
    console.error('❌ Firebase initialization error:', error.message);
    console.error('Full error object:', error);
    console.error('Stack trace:', error.stack);
    throw error;
  }
};

// Initialize Firebase
console.log('📦 firebase.js module loading...');
const firebaseAdmin = initializeFirebase();

// Get Firestore database instance
console.log('🔄 Getting Firestore instance...');
const db = firebaseAdmin.firestore();

// Get Firebase Auth instance
console.log('🔄 Getting Auth instance...');
const auth = firebaseAdmin.auth();

console.log('🔄 Getting Realtime Database instance...');
const realtimeDb = firebaseAdmin.database();

console.log('✅ All Firebase services initialized');

module.exports = {
  admin: firebaseAdmin,
  db,
  auth,
  realtimeDb
};
