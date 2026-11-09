/**
 * Settings of your Firebase web app.
 * Firebase Console → Project settings → General → Your apps → Web app → "SDK setup and configuration" → Config.
 *
 * These values are not secrets (they ship in every Firebase website). What protects the data
 * are the Firestore rules in firestore.rules, not hiding this file.
 */
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyD5fjSp71Q_PiNDUDmspMn4iPouzl0j4B0',
  authDomain: 'modexa3d-6c4f2.firebaseapp.com',
  projectId: 'modexa3d-6c4f2',
  appId: '1:430343232936:web:0b5317013518bd0228919d',
};

export const isFirebaseConfigured = (): boolean => !FIREBASE_CONFIG.apiKey.startsWith('PASTE');