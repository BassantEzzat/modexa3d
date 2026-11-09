import type { Auth as FirebaseAuth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import { FIREBASE_CONFIG, isFirebaseConfigured } from './firebase-config';

export { isFirebaseConfigured };

export interface FirebaseSdk {
  readonly auth: FirebaseAuth;
  readonly db: Firestore;
  readonly authApi: typeof import('firebase/auth');
  readonly fs: typeof import('firebase/firestore');
}

let sdk: Promise<FirebaseSdk> | null = null;

/**
 * Loads Firebase the first time it is needed, as separate files, so the first load of the site
 * stays as light as before. Every caller gets the same instance.
 */
export function loadFirebase(): Promise<FirebaseSdk> {
  sdk ??= (async () => {
    const [{ initializeApp }, authApi, fs] = await Promise.all([
      import('firebase/app'),
      import('firebase/auth'),
      import('firebase/firestore'),
    ]);
    const app = initializeApp(FIREBASE_CONFIG);
    return { auth: authApi.getAuth(app), db: fs.getFirestore(app), authApi, fs };
  })().catch((error) => {
    sdk = null; // the next call tries again instead of reusing the failure
    throw error;
  });
  return sdk;
}