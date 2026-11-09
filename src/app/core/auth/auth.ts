import { Injectable, signal } from '@angular/core';
import type { User } from 'firebase/auth';
import { isFirebaseConfigured, loadFirebase } from '../firebase/firebase';

export type AuthStatus =
  | 'loading' // checking if someone is already signed in
  | 'unconfigured' // firebase-config.ts still has the placeholders
  | 'signedOut'
  | 'checking' // signed in with Google, looking the email up in the allowed list
  | 'denied' // signed in, but the email is not on the list
  | 'allowed'
  | 'error';

/**
 * Google sign-in plus an allowed-emails list.
 * The list is the Firestore collection `allowedEmails` (one document per email, named by the email).
 * The same list is enforced by the Firestore rules, so skipping this screen does not give access to any data.
 */
@Injectable({ providedIn: 'root' })
export class Auth {
  readonly status = signal<AuthStatus>('loading');
  readonly email = signal<string | null>(null);
  readonly uid = signal<string | null>(null);
  readonly signInFailed = signal(false);

  private checkId = 0;

  constructor() {
    void this.start();
  }

  async signIn(): Promise<void> {
    this.signInFailed.set(false);
    try {
      const { auth, authApi } = await loadFirebase();
      const provider = new authApi.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      try {
        await authApi.signInWithPopup(auth, provider);
      } catch (error: any) {
        const code = error?.code;
        if (code === 'auth/popup-blocked') {
          await authApi.signInWithRedirect(auth, provider); // some phone browsers block popups
          return;
        }
        if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
        throw error;
      }
    } catch (error) {
      console.error('Sign-in failed', error);
      this.signInFailed.set(true);
    }
  }

  async signOut(): Promise<void> {
    try {
      const { auth, authApi } = await loadFirebase();
      await authApi.signOut(auth);
    } catch (error) {
      console.error('Sign-out failed', error);
    }
  }

  private async start(): Promise<void> {
    if (!isFirebaseConfigured()) {
      this.status.set('unconfigured');
      return;
    }
    try {
      const { auth, authApi } = await loadFirebase();
      authApi.onAuthStateChanged(auth, (user) => void this.onUser(user));
    } catch (error) {
      console.error('Could not start Firebase', error);
      this.status.set('error');
    }
  }

  private async onUser(user: User | null): Promise<void> {
    const id = ++this.checkId;

    if (!user) {
      this.email.set(null);
      this.uid.set(null);
      this.status.set('signedOut');
      return;
    }

    const email = (user.email ?? '').trim().toLowerCase();
    this.email.set(email || null);
    this.uid.set(null); // nothing is synced until the email is confirmed
    this.status.set('checking');

    if (!email || !user.emailVerified) {
      this.status.set('denied');
      return;
    }

    try {
      const { db, fs } = await loadFirebase();
      const entry = await fs.getDoc(fs.doc(db, 'allowedEmails', email));
      if (id !== this.checkId) return; // someone else signed in meanwhile

      if (entry.exists()) {
        this.uid.set(user.uid);
        this.status.set('allowed');
      } else {
        this.status.set('denied');
      }
    } catch (error) {
      console.error('Could not check the allowed list', error);
      if (id === this.checkId) this.status.set('error');
    }
  }
}