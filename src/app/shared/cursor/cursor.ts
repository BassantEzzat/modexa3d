import { Component, DestroyRef, ElementRef, afterNextRender, effect, inject, viewChild } from '@angular/core';
import gsap from 'gsap';
import { I18n } from '../../core/i18n/i18n';
import { ModelStore } from '../../core/state/model-store';

// Add data-cursor="Text" to any element to show a small word next to the cursor.
const LABEL_SELECTOR = '[data-cursor]';
const TEXT_SELECTOR = 'input[type="text"], textarea';

@Component({
  selector: 'app-cursor',
  template: `
    <div class="ring" #ring><span class="label" #label></span></div>
    <div class="dot" #dot></div>
  `,
  styles: `
    :host {
      display: contents;
    }

    .ring,
    .dot {
      position: fixed;
      top: 0;
      left: 0;
      z-index: 9999;
      pointer-events: none;
      border-radius: 50%;
      opacity: 0;
      will-change: transform;
    }

    /* Always the project's accent color, with a thin dark edge so it shows on any background */
    .dot {
      width: 6px;
      height: 6px;
      background: var(--accent);
      box-shadow: 0 0 0 1px rgba(var(--overlay-rgb), 0.6);
    }

    .ring {
      width: 30px;
      height: 30px;
      border: 1.5px solid var(--accent);
      box-shadow:
        0 0 0 1px rgba(var(--overlay-rgb), 0.35),
        inset 0 0 0 1px rgba(var(--overlay-rgb), 0.35);
      transition:
        width 0.2s ease,
        height 0.2s ease;
    }

    /* Only gets a little smaller while the mouse is pressed (like dragging the model) */
    .ring.down {
      width: 24px;
      height: 24px;
    }

    /* A small tag next to the ring. The ring itself never changes. */
    .label {
      position: absolute;
      top: 50%;
      left: calc(100% + 8px);
      transform: translateY(-50%);
      padding: 0.2rem 0.6rem;
      border-radius: 999px;
      background: var(--accent);
      color: var(--on-accent);
      font-size: 0.7rem;
      font-weight: 600;
      white-space: nowrap;
      opacity: 0;
      transition: opacity 0.2s ease;
    }
    .ring.has-label .label {
      opacity: 1;
    }
  `,
})
export class Cursor {
  private readonly store = inject(ModelStore);
  private readonly i18n = inject(I18n);
  private readonly ring = viewChild.required<ElementRef<HTMLElement>>('ring');
  private readonly dot = viewChild.required<ElementRef<HTMLElement>>('dot');
  private readonly label = viewChild.required<ElementRef<HTMLElement>>('label');

  private active = false;
  private visible = false;
  private overPart = false;
  private addingPoint = false;
  private overText = false;
  private elementLabel = '';

  constructor() {
    // The mouse is over a part of the 3D model, "add a point" mode changed, or the language changed
    effect(() => {
      this.overPart = this.store.hoveringPart();
      this.addingPoint = this.store.hotspotMode();
      this.i18n.lang();
      if (this.active) this.refresh();
    });

    const cleanups: Array<() => void> = [];
    const on = (target: EventTarget, type: string, handler: (event: any) => void): void => {
      target.addEventListener(type, handler);
      cleanups.push(() => target.removeEventListener(type, handler));
    };

    inject(DestroyRef).onDestroy(() => {
      cleanups.forEach((undo) => undo());
      document.documentElement.classList.remove('custom-cursor');
    });

    afterNextRender(() => {
      // على الموبايل واللمس مفيش cursor
      if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

      const ring = this.ring().nativeElement;
      const dot = this.dot().nativeElement;

      gsap.set([ring, dot], { xPercent: -50, yPercent: -50 });

      // ===== السرعة: كل ما الرقم يقل، الحركة أسرع =====
      const ringX = gsap.quickTo(ring, 'x', { duration: 0.1, ease: 'power3.out' });
      const ringY = gsap.quickTo(ring, 'y', { duration: 0.18, ease: 'power3.out' });
      const dotX = gsap.quickTo(dot, 'x', { duration: 0.04, ease: 'none' });
      const dotY = gsap.quickTo(dot, 'y', { duration: 0.04, ease: 'none' });

      this.active = true;
      // From now on the system cursor is hidden (see the global styles)
      document.documentElement.classList.add('custom-cursor');

      on(window, 'mousemove', (e: MouseEvent) => {
        if (!this.visible) {
          this.visible = true;
          gsap.set([ring, dot], { x: e.clientX, y: e.clientY, opacity: this.overText ? 0 : 1 });
        }
        ringX(e.clientX);
        ringY(e.clientY);
        dotX(e.clientX);
        dotY(e.clientY);
      });

      on(document, 'mouseover', (e: MouseEvent) => {
        const element = e.target as HTMLElement | null;
        this.elementLabel = element?.closest<HTMLElement>(LABEL_SELECTOR)?.getAttribute('data-cursor') ?? '';
        this.overText = !!element?.closest(TEXT_SELECTOR); // over a text field the normal I-beam is better
        this.refresh();
      });

      on(window, 'mousedown', () => ring.classList.add('down'));
      on(window, 'mouseup', () => ring.classList.remove('down'));

      on(document.documentElement, 'mouseleave', () => {
        gsap.to([ring, dot], { opacity: 0, duration: 0.3, overwrite: 'auto' });
      });
      on(document.documentElement, 'mouseenter', () => {
        if (this.visible) this.refresh();
      });

      this.refresh();
    });
  }

  /** Shows or hides the small tag, and whether the cursor is visible at all. The ring never changes size or color. */
  private refresh(): void {
    const ring = this.ring().nativeElement;
    const dot = this.dot().nativeElement;
    const label = this.label().nativeElement;

    let text = this.elementLabel;
    if (this.overPart) text = this.i18n.t(this.addingPoint ? 'cursor.addPoint' : 'cursor.edit');

    ring.classList.toggle('has-label', !!text);
    if (text) label.textContent = text;

    if (this.visible) {
      gsap.to([ring, dot], { opacity: this.overText ? 0 : 1, duration: 0.2, overwrite: 'auto' });
    }
  }
}