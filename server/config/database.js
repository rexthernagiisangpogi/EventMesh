require('dotenv').config();

const {
  applicationDefault,
  initializeApp,
  getApps,
} = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;
if (!projectId) {
  throw new Error('FIREBASE_PROJECT_ID must be set for the Firebase Admin SDK');
}

const firebaseApp = getApps()[0] || initializeApp({
  credential: applicationDefault(),
  projectId,
});
const db = getFirestore(firebaseApp);

module.exports = db;
