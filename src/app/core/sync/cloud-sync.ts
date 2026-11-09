import { Injectable, effect, inject, untracked } from '@angular/core';
import { Auth } from '../auth/auth';
import { loadFirebase } from '../firebase/firebase';
import { I18n, Lang } from '../i18n/i18n';
import { ModelStore } from '../state/model-store';
import { Theme, ThemeStore } from '../state/theme-store';

const SAVE_DELAY_MS = 800;
const MAX_RECENT = 8;

/** What is kept in the cloud for each user (one document: users/<uid>). */
interface Payload {
  designsJson: string; // the saved designs, as JSON text (Firestore does not accept undefined / nested arrays)
  recent: string[]; // colors picked by hand
  lang: Lang;
  theme: Theme;
}

/**
 * Keeps the saved designs, the recent colors, the language and the theme in the user's Firestore document,
 * so another device shows the same data after signing in.
 *
 * - First load after signing in: what is in the cloud and what is on this device are merged (nothing is lost).
 * - After that: changes are sent about a second after the last edit, and changes made on another device
 *   arrive live (the most recent write wins).
 * Uploaded .glb files are not part of this: they stay on the device that uploaded them.
 */
@Injectable({ providedIn: 'root' })
export class CloudSync {
  private readonly store = inject(ModelStore);
  private readonly auth = inject(Auth);
  private readonly i18n = inject(I18n);
  private readonly theme = inject(ThemeStore);

  private unsubscribe: (() => void) | null = null;
  private session = 0;
  private ready = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastSent = '';

  constructor() {
    // Start when an allowed user is signed in, stop when they leave
    effect(() => {
      const uid = this.auth.status() === 'allowed' ? this.auth.uid() : null;
      untracked(() => (uid ? void this.start(uid) : this.stop()));
    });

    // Any change to the synced data schedules a save
    effect(() => {
      const json = JSON.stringify(this.payload());
      untracked(() => this.schedule(json));
    });
  }

  private payload(): Payload {
    return {
      designsJson: JSON.stringify(this.store.designs()),
      recent: this.store.recentColors(),
      lang: this.i18n.lang(),
      theme: this.theme.theme(),
    };
  }

  private async start(uid: string): Promise<void> {
    this.stop();
    const session = ++this.session;

    try {
      const { db, fs } = await loadFirebase();
      if (session !== this.session) return;

      let first = true;
      this.unsubscribe = fs.onSnapshot(
        fs.doc(db, 'users', uid),
        (snapshot) => {
          if (session !== this.session) return;
          if (snapshot.metadata.hasPendingWrites) return; // our own write, not news
          const data = snapshot.data();

          if (first) {
            first = false;
            this.mergeFirst(data);
            this.ready = true;
            void this.flush();
          } else if (data) {
            this.applyRemote(data);
          }
        },
        (error) => console.error('Cloud sync stopped', error),
      );
    } catch (error) {
      console.error('Could not start the cloud sync', error);
    }
  }

  private stop(): void {
    this.session++;
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.ready = false;
    this.lastSent = '';
  }

  /** First snapshot after signing in: keep everything from both sides. */
  private mergeFirst(data: Record<string, unknown> | undefined): void {
    const remote = this.store.parseDesigns(data?.['designsJson']);
    const known = new Set(remote.map((design) => design.id));
    const merged = [...remote, ...this.store.designs().filter((design) => !known.has(design.id))].sort(
      (a, b) => b.savedAt - a.savedAt,
    );
    this.store.replaceDesigns(merged);

    const remoteRecent = Array.isArray(data?.['recent']) ? (data['recent'] as unknown[]) : [];
    const recent = [...remoteRecent, ...this.store.recentColors()].filter((c): c is string => typeof c === 'string');
    this.store.setRecentColors([...new Set(recent)].slice(0, MAX_RECENT));

    this.applyLang(data?.['lang']);
    this.applyTheme(data?.['theme']);
  }

  /** A change made on another device. Skipped while this device has an edit that is not sent yet. */
  private applyRemote(data: Record<string, unknown>): void {
    if (this.timer) return;

    const designs = this.store.parseDesigns(data['designsJson']);
    if (JSON.stringify(designs) !== JSON.stringify(this.store.designs())) this.store.replaceDesigns(designs);

    if (Array.isArray(data['recent'])) {
      const recent = (data['recent'] as unknown[]).filter((c): c is string => typeof c === 'string');
      if (JSON.stringify(recent) !== JSON.stringify(this.store.recentColors())) this.store.setRecentColors(recent);
    }

    this.applyLang(data['lang']);
    this.applyTheme(data['theme']);
    this.lastSent = JSON.stringify(this.payload()); // what we just received is not something to send back
  }

  private applyLang(value: unknown): void {
    if ((value === 'en' || value === 'ar') && value !== this.i18n.lang()) this.i18n.lang.set(value);
  }

  private applyTheme(value: unknown): void {
    if ((value === 'dark' || value === 'light') && value !== this.theme.theme()) this.theme.theme.set(value);
  }

  private schedule(json: string): void {
    if (!this.ready || json === this.lastSent) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, SAVE_DELAY_MS);
  }

  private async flush(): Promise<void> {
    const uid = this.auth.uid();
    if (!uid || !this.ready) return;

    const payload = this.payload();
    const json = JSON.stringify(payload);
    if (json === this.lastSent) return;

    try {
      const { db, fs } = await loadFirebase();
      await fs.setDoc(fs.doc(db, 'users', uid), { ...payload, updatedAt: fs.serverTimestamp() }, { merge: true });
      this.lastSent = json;
    } catch (error) {
      // Offline or blocked: the data is still on this device, the next change tries again
      console.error('Could not save to the cloud', error);
    }
  }
}