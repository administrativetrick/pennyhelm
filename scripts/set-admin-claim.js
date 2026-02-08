// One-time script to set Firebase Custom Claims for admin users.
// Run: node scripts/set-admin-claim.js
//
// Requires firebase-service-account.json in project root.
// Get it from: Firebase Console → Project Settings → Service Accounts → Generate New Private Key

const admin = require('firebase-admin');
const path = require('path');

const SERVICE_ACCOUNT_PATH = path.join(__dirname, '..', 'firebase-service-account.json');
const ADMIN_EMAIL = 'james.l.curtis@gmail.com';

let serviceAccount;
try {
    serviceAccount = require(SERVICE_ACCOUNT_PATH);
} catch (e) {
    console.error('Error: firebase-service-account.json not found in project root.');
    console.error('Download it from: Firebase Console → Project Settings → Service Accounts → Generate New Private Key');
    process.exit(1);
}

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

async function setAdminClaim() {
    try {
        const user = await admin.auth().getUserByEmail(ADMIN_EMAIL);
        console.log(`Found user: ${user.email} (uid: ${user.uid})`);

        await admin.auth().setCustomUserClaims(user.uid, { admin: true });
        console.log(`✓ Admin claim set for ${ADMIN_EMAIL}`);
        console.log('');
        console.log('IMPORTANT: The user must sign out and sign back in for the claim to take effect.');
        console.log('Custom claims are embedded in the ID token, which is refreshed on sign-in.');
    } catch (e) {
        if (e.code === 'auth/user-not-found') {
            console.error(`Error: No user found with email ${ADMIN_EMAIL}`);
            console.error('Make sure this user has signed up first.');
        } else {
            console.error('Error setting admin claim:', e.message);
        }
        process.exit(1);
    }

    process.exit(0);
}

setAdminClaim();
