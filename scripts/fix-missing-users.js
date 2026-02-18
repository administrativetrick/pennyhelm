/**
 * fix-missing-users.js
 *
 * Finds all documents in the `userData` collection that do NOT have
 * a corresponding document in the `users` collection, then creates
 * the missing `users` entry for each one.
 */

const admin = require('firebase-admin');
const path = require('path');

const SERVICE_ACCOUNT_PATH = path.join(__dirname, '..', 'firebase-service-account.json');
const serviceAccount = require(SERVICE_ACCOUNT_PATH);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function fixMissingUsers() {
  console.log('Fetching all userData documents...');
  const userDataSnap = await db.collection('userData').get();
  console.log(`Found ${userDataSnap.size} userData documents.`);

  console.log('Fetching all users documents...');
  const usersSnap = await db.collection('users').get();
  const existingUserIds = new Set(usersSnap.docs.map(d => d.id));
  console.log(`Found ${usersSnap.size} users documents.`);

  // Find UIDs in userData but not in users
  const orphaned = [];
  userDataSnap.forEach(docSnap => {
    if (!existingUserIds.has(docSnap.id)) {
      orphaned.push({ uid: docSnap.id, data: docSnap.data() });
    }
  });

  if (orphaned.length === 0) {
    console.log('\nNo orphaned userData entries found. All users are in sync.');
    return;
  }

  console.log(`\nFound ${orphaned.length} orphaned userData entries (no matching users doc):`);

  for (const { uid, data } of orphaned) {
    console.log(`\n--- UID: ${uid} ---`);
    console.log(`  userName: ${data.userName || '(none)'}`);
    console.log(`  email in userData: ${data.email || '(none)'}`);

    // Try to get email/displayName from Firebase Auth
    let authEmail = '';
    let authDisplayName = '';
    try {
      const authUser = await admin.auth().getUser(uid);
      authEmail = authUser.email || '';
      authDisplayName = authUser.displayName || '';
      console.log(`  Firebase Auth email: ${authEmail}`);
      console.log(`  Firebase Auth displayName: ${authDisplayName}`);
      console.log(`  Auth provider(s): ${authUser.providerData.map(p => p.providerId).join(', ')}`);
      console.log(`  Auth createdAt: ${authUser.metadata.creationTime}`);
    } catch (e) {
      console.log(`  WARNING: Could not fetch Firebase Auth record: ${e.message}`);
    }

    // Create the missing users doc
    const usersDoc = {
      email: authEmail || data.email || '',
      displayName: authDisplayName || data.userName || '',
      subscriptionStatus: 'trial',
      trialStartDate: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    console.log(`  Creating users/${uid} with:`, JSON.stringify({ ...usersDoc, trialStartDate: '(serverTimestamp)', createdAt: '(serverTimestamp)' }));

    await db.collection('users').doc(uid).set(usersDoc);
    console.log(`  ✓ Created users/${uid}`);
  }

  console.log(`\nDone! Fixed ${orphaned.length} orphaned user(s).`);
}

fixMissingUsers().catch(err => {
  console.error('FATAL ERROR:', err);
  process.exit(1);
});
