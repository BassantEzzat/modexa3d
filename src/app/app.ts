import { Component, effect, inject, signal } from '@angular/core';
import { ModelStore } from './core/state/model-store';
import { Topbar } from './shared/topbar/topbar';
import { Viewer } from './features/viewer/viewer';
import { Customizer } from './features/customizer/customizer';
import { Cursor } from './shared/cursor/cursor';

@Component({
  selector: 'app-root',
  imports: [Topbar, Viewer, Customizer, Cursor],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  host: { '(document:keydown)': 'onKeydown($event)' },
})
export class App {
  private readonly store = inject(ModelStore);

  readonly panelOpen = signal(false);

  constructor() {
    // Tapping a part of the model opens the panel (on phones it starts collapsed)
    effect(() => {
      if (this.store.selectedId()) this.panelOpen.set(true);
    });
  }

  togglePanel(): void {
    this.panelOpen.update((open) => !open);
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