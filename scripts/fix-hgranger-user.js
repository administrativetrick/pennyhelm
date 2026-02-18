/**
 * One-time script to add missing subscription fields to hgranger's users document
 *
 * Run with: node scripts/fix-hgranger-user.js
 *
 * Uses application default credentials (gcloud auth application-default login)
 */

const admin = require('firebase-admin');

// Initialize with application default credentials
admin.initializeApp({
  projectId: 'cashpilot-c58d5'
});

const db = admin.firestore();

async function fixHgrangerUser() {
  const uid = 'NSXw5V7Qu2Uv7MIqgof7dt22pFx1';
  const userRef = db.collection('users').doc(uid);

  console.log(`Updating users document for UID: ${uid}`);

  try {
    // Check current state
    const doc = await userRef.get();
    if (!doc.exists) {
      console.error('ERROR: Document does not exist!');
      process.exit(1);
    }

    console.log('Current document fields:', Object.keys(doc.data()));
    console.log('Current data:', JSON.stringify(doc.data(), null, 2));

    // Add missing subscription fields (merge to preserve existing fields)
    await userRef.set({
      email: 'hgranger86@gmail.com',
      subscriptionStatus: 'trial',
      trialStartDate: new Date('2026-02-06T00:00:00.000Z'),
      createdAt: new Date('2026-02-06T00:00:00.000Z')
    }, { merge: true });

    console.log('✅ Successfully added missing fields!');

    // Verify the update
    const updatedDoc = await userRef.get();
    console.log('Updated document fields:', Object.keys(updatedDoc.data()));
    console.log('Updated data:', JSON.stringify(updatedDoc.data(), null, 2));

  } catch (error) {
    console.error('ERROR:', error.message);
    process.exit(1);
  }

  process.exit(0);
}

fixHgrangerUser();
