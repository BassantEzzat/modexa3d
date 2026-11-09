import { Component, inject } from '@angular/core';
import { Auth } from '../../core/auth/auth';
import { I18n } from '../../core/i18n/i18n';
import { ModelStore } from '../../core/state/model-store';
import { ThemeStore } from '../../core/state/theme-store';

@Component({
  selector: 'app-topbar',
  templateUrl: './topbar.html',
  styleUrl: './topbar.scss',
})
export class Topbar {
  protected readonly store = inject(ModelStore);
  protected readonly theme = inject(ThemeStore);
  protected readonly i18n = inject(I18n);
  protected readonly auth = inject(Auth);
}