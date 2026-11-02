import { Component, DestroyRef, ElementRef, afterNextRender, effect, inject, signal, viewChild } from '@angular/core';
import { LENGTH_UNITS, ModelStore } from '../../core/state/model-store';
import { ModelGallery } from './model-gallery/model-gallery';
import { I18n } from '../../core/i18n/i18n';
import { AnimationInfo } from '../../core/three/scene-manager';

const BUBBLE_WIDTH = 200; // must match the note bubble in viewer.scss
const BUBBLE_MARGIN = 8;

@Component({
  selector: 'app-viewer',
  imports: [ModelGallery],
  templateUrl: './viewer.html',
  styleUrl: './viewer.scss',
  host: {
    '[class.dragging]': 'dragging()',
    '(dragenter)': 'onDragEnter($event)',
    '(dragover)': 'onDragOver($event)',
    '(dragleave)': 'onDragLeave($event)',
    '(drop)': 'onDrop($event)',
    '(document:keydown.escape)': 'onEscape()',
  },
})
export class Viewer {
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly store = inject(ModelStore);
  protected readonly i18n = inject(I18n);
  protected readonly units = LENGTH_UNITS;
  protected readonly speeds = [0.25, 0.5, 1, 1.5, 2];

  // dragenter/dragleave also fire for child elements, so we count them
  private dragDepth = 0;
  protected readonly dragging = signal(false);

  // Where the pointer went down, to tell a tap on the model from a drag that rotates it
  private downX = 0;
  private downY = 0;

  private moveFrame = 0;

  constructor() {
    afterNextRender(() => this.store.attach(this.canvas().nativeElement));
    inject(DestroyRef).onDestroy(() => this.store.detach());

    // A note was opened (or just created): put the cursor in its text field
    effect(() => {
      if (!this.store.activeHotspot()) return;
      setTimeout(() => this.host.nativeElement.querySelector<HTMLTextAreaElement>('.bubble textarea')?.focus(), 60);
    });
  }

  protected onCanvasDown(event: PointerEvent): void {
    this.downX = event.clientX;
    this.downY = event.clientY;
    this.store.hoveringPart.set(false); // while pressing or dragging, the cursor is back to normal
  }

  /** Checks what is under the mouse, at most once per frame. Phones have no hover, so touch is skipped. */
  protected onCanvasMove(event: PointerEvent): void {
    if (event.pointerType === 'touch' || event.buttons !== 0 || this.moveFrame) return;

    const { clientX, clientY } = event;
    this.moveFrame = requestAnimationFrame(() => {
      this.moveFrame = 0;
      this.store.hoveringPart.set(this.store.partAt(clientX, clientY));
    });
  }

  protected onCanvasLeave(): void {
    cancelAnimationFrame(this.moveFrame);
    this.moveFrame = 0;
    this.store.hoveringPart.set(false);
  }

  /** A tap (almost no movement): places a point in "add" mode, otherwise selects the material under it. */
  protected onCanvasUp(event: PointerEvent): void {
    if (event.button !== 0) return;
    const moved = Math.hypot(event.clientX - this.downX, event.clientY - this.downY);
    if (moved >= 5) return;

    if (this.store.hotspotMode()) {
      this.store.addHotspotAt(event.clientX, event.clientY);
    } else if (this.store.measureMode()) {
      this.store.addMeasurePointAt(event.clientX, event.clientY);
    } else {
      this.store.selectHotspot(null); // a tap outside closes the open note
      this.store.pickAt(event.clientX, event.clientY);
    }
  }

  // ---- Hotspots -----------------------------------------------------------

  protected onEscape(): void {
    if (this.store.hotspotMode()) this.store.hotspotMode.set(false);
    if (this.store.measureMode()) this.store.stopMeasuring();
    this.store.selectHotspot(null);
  }

  /** Enter closes the note (Shift+Enter would add a line, but notes are short, so it is blocked too). */
  protected onNoteEnter(event: Event): void {
    event.preventDefault();
    this.store.selectHotspot(null);
  }

  /** How far the note bubble must move sideways to stay fully inside the canvas. */
  protected bubbleShift(x: number): number {
    const width = this.store.hotspotView().width;
    const wanted = x - BUBBLE_WIDTH / 2;
    const left = Math.min(Math.max(wanted, BUBBLE_MARGIN), Math.max(BUBBLE_MARGIN, width - BUBBLE_WIDTH - BUBBLE_MARGIN));
    return left - wanted;
  }

  /** The line at the bottom of the viewer: what a tap on the model does right now. */
  protected hintText(): string {
    if (this.store.hotspotMode()) return this.i18n.t('hotspot.hint');
    if (this.store.measureMode()) {
      return this.i18n.t(this.store.measurePending() ? 'measure.second' : 'measure.hint');
    }
    return this.i18n.t('viewer.hint');
  }

  // ---- Before / after divider ---------------------------------------------

  protected onCompareDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.moveCompare(event);
  }

  protected onCompareMove(event: PointerEvent): void {
    if (!(event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId)) return;
    this.moveCompare(event);
  }

  /** Arrow keys move the divider, so it works without a mouse too. */
  protected onCompareKey(event: KeyboardEvent): void {
    const step = event.shiftKey ? 0.1 : 0.02;
    if (event.key === 'ArrowLeft') this.store.setComparePosition(this.store.comparePosition() - step);
    else if (event.key === 'ArrowRight') this.store.setComparePosition(this.store.comparePosition() + step);
    else return;
    event.preventDefault();
  }

  private moveCompare(event: PointerEvent): void {
    const layer = (event.currentTarget as HTMLElement).parentElement;
    if (!layer) return;
    const rect = layer.getBoundingClientRect();
    if (!rect.width) return;
    this.store.setComparePosition((event.clientX - rect.left) / rect.width);
  }

  // ---- Dimensions ---------------------------------------------------------

  /** A length in meters, shown in the chosen unit. */
  protected dimension(meters: number): string {
    const unit = this.units.find((item) => item.id === this.store.unit()) ?? this.units[1];
    const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: unit.decimals }).format(
      meters * unit.perMeter,
    );
    return `${number} ${this.i18n.t(unit.label)}`;
  }

  // ---- Animation bar ------------------------------------------------------

  protected onSeek(event: Event): void {
    this.store.seekAnimation(Number((event.target as HTMLInputElement).value));
  }

  protected onClip(event: Event): void {
    this.store.selectAnimation(Number((event.target as HTMLSelectElement).value));
  }

  protected onSpeed(event: Event): void {
    this.store.setAnimationSpeed(Number((event.target as HTMLSelectElement).value));
  }

  /** The name of an animation, or "Animation 2" when the file did not name it. */
  protected clipName(clip: AnimationInfo): string {
    return clip.name || this.i18n.t('anim.unnamed', { n: clip.index + 1 });
  }

  // ---- Drag & drop of files -----------------------------------------------

  protected onDragEnter(event: DragEvent): void {
    if (!this.hasFiles(event)) return;
    event.preventDefault();
    this.dragDepth++;
    this.dragging.set(true);
  }

  protected onDragOver(event: DragEvent): void {
    if (!this.hasFiles(event)) return;
    event.preventDefault(); // required, otherwise the browser won't allow dropping
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }

  protected onDragLeave(event: DragEvent): void {
    if (!this.hasFiles(event)) return;
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (this.dragDepth === 0) this.dragging.set(false);
  }

  protected onDrop(event: DragEvent): void {
    if (!this.hasFiles(event)) return;
    event.preventDefault();
    this.dragDepth = 0;
    this.dragging.set(false);

    const file = event.dataTransfer?.files[0];
    if (file) void this.store.loadFile(file);
  }

  private hasFiles(event: DragEvent): boolean {
    return event.dataTransfer?.types.includes('Files') ?? false;
  }
}