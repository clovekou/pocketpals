// Online mode settings.
// Paste your Firebase web app config below (Firebase console → Project settings → General → Your apps → Web app → "Config").
// These keys are meant to be in the page; access is protected by the rules in firestore.rules, not by hiding them.
// Leave FIREBASE_CONFIG as null to play offline: everything then stays in this browser, as before.
window.PP = window.PP || {};
PP.FIREBASE_CONFIG = null;
/* Example:
PP.FIREBASE_CONFIG = {
  apiKey: '…',
  authDomain: 'your-project.firebaseapp.com',
  projectId: 'your-project',
  storageBucket: 'your-project.appspot.com',
  messagingSenderId: '…',
  appId: '…',
};
*/
