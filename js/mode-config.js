// App mode: 'selfhost' (Express + SQLite) or 'cloud' (Firestore + Firebase Hosting)
// Selfhost is the default so Docker and local installs work out of the box.
// Change to 'cloud' before running `firebase deploy` for the hosted build.
export const APP_MODE = 'selfhost';
