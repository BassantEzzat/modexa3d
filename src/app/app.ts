import { Component, effect, inject, signal } from '@angular/core';
import { ModelStore } from './core/state/model-store';
import { Topbar } from './shared/topbar/topbar';
import { Viewer } from './features/viewer/viewer';
import { Customizer } from './features/customizer/customizer';
import { Cursor } from './shared/cursor/cursor';
import { Gate } from './shared/gate/gate';
import { CloudSync } from './core/sync/cloud-sync';

@Component({
  selector: 'app-root',
  imports: [Topbar, Viewer, Customizer, Cursor, Gate],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  host: {
    '(document:keydown)': 'onKeydown($event)',
    '(document:pointerdown)': 'onOutsidePointer($event)',
  },
})
export class App {
  private readonly store = inject(ModelStore);

  readonly panelOpen = signal(false);

  constructor() {
    inject(CloudSync); // starts keeping the saved designs in step with the cloud once someone signs in

    // Tapping a part of the model opens the panel (on phones it starts collapsed).
    // It listens to the tap itself, so tapping the same part again opens it too.
    effect(() => {
      if (this.store.pickTick() > 0) this.panelOpen.set(true);
    });
  }

  togglePanel(): void {
    this.panelOpen.update((open) => !open);
  }

  /** Pressing anywhere outside the customize panel closes it (on phones, where it slides up as a sheet). */
  protected onOutsidePointer(event: PointerEvent): void {
    if (!this.panelOpen()) return;
    const target = event.target as Element | null;
    if (target?.closest('app-customizer')) return;
    this.panelOpen.set(false);
  }

  /** Ctrl/Cmd+Z = undo, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y = redo */
  protected onKeydown(event: KeyboardEvent): void {
    if (!(event.ctrlKey || event.metaKey)) return;

    // While typing (like naming a design), Ctrl+Z belongs to the text field
    const target = event.target as HTMLElement | null;
    if (target?.tagName === 'INPUT' && (target as HTMLInputElement).type === 'text') return;

    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      this.store.undo();
    } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
      event.preventDefault();
      this.store.redo();
    }
  }
}