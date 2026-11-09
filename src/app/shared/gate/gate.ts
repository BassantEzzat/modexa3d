import { Component, inject } from '@angular/core';
import { Auth } from '../../core/auth/auth';
import { I18n } from '../../core/i18n/i18n';

/** A full-screen sign-in wall. It disappears once the user is signed in and on the allowed list. */
@Component({
  selector: 'app-gate',
  template: `
    @if (auth.status() !== 'allowed') {
      <div class="gate" role="dialog" aria-modal="true" aria-labelledby="gate-title">
        <div class="card">
          <span class="mark" aria-hidden="true">M</span>

          @switch (auth.status()) {
            @case ('signedOut') {
              <h1 id="gate-title">{{ i18n.t('auth.title') }}</h1>
              <p>{{ i18n.t('auth.subtitle') }}</p>
              @if (auth.signInFailed()) {
                <p class="error" role="alert">{{ i18n.t('auth.signInFail') }}</p>
              }
              <button class="btn primary" type="button" (click)="auth.signIn()">
                {{ i18n.t('auth.google') }}
              </button>
            }
            @case ('denied') {
              <h1 id="gate-title">{{ i18n.t('auth.deniedTitle') }}</h1>
              <p dir="auto">{{ i18n.t('auth.denied', { email: auth.email() ?? '' }) }}</p>
              <button class="btn primary" type="button" (click)="auth.signOut()">
                {{ i18n.t('auth.switch') }}
              </button>
            }
            @case ('unconfigured') {
              <h1 id="gate-title">{{ i18n.t('auth.setupTitle') }}</h1>
              <p>{{ i18n.t('auth.notConfigured') }}</p>
            }
            @case ('error') {
              <h1 id="gate-title">{{ i18n.t('auth.errorTitle') }}</h1>
              <p>{{ i18n.t('auth.error') }}</p>
              <button class="btn primary" type="button" (click)="reload()">{{ i18n.t('auth.retry') }}</button>
            }
            @default {
              <h1 id="gate-title" class="sr">{{ i18n.t('auth.checking') }}</h1>
              <div class="spinner" role="status" [attr.aria-label]="i18n.t('auth.checking')"></div>
              <p>{{ i18n.t('auth.checking') }}</p>
            }
          }
        </div>
      </div>
    }
  `,
  styles: `
    .gate {
      position: fixed;
      inset: 0;
      z-index: 9000; /* above the app, below the animated cursor */
      display: grid;
      place-items: center;
      padding: 1rem;
      background: var(--bg);
    }

    .card {
      width: min(100%, 420px);
      display: grid;
      justify-items: center;
      gap: 0.9rem;
      padding: 2rem 1.5rem;
      text-align: center;
      border: 1px solid var(--border);
      border-radius: 24px;
      background: var(--surface);
    }

    .mark {
      width: 48px;
      height: 48px;
      display: grid;
      place-items: center;
      border-radius: 14px;
      background: linear-gradient(135deg, var(--accent), var(--accent-strong));
      color: var(--on-accent);
      font-family: var(--font-display);
      font-size: 1.4rem;
      font-weight: 700;
    }

    h1 {
      font-size: 1.4rem;
    }

    p {
      color: var(--muted);
      font-size: 0.95rem;
    }

    .error {
      color: var(--danger);
    }

    .sr {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }

    .spinner {
      width: 40px;
      height: 40px;
      border: 3px solid var(--border);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
  `,
})
export class Gate {
  protected readonly auth = inject(Auth);
  protected readonly i18n = inject(I18n);

  protected reload(): void {
    location.reload();
  }
}