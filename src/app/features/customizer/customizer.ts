import { Component, effect, inject, input, output } from '@angular/core';
import { I18n, TextKey } from '../../core/i18n/i18n';
import { ModelStore, SavedDesign } from '../../core/state/model-store';
import { LightingPreset, MaterialInfo } from '../../core/three/scene-manager';

@Component({
  selector: 'app-customizer',
  templateUrl: './customizer.html',
  styleUrl: './customizer.scss',
  host: { '[class.open]': 'open()' },
})
export class Customizer {
  protected readonly store = inject(ModelStore);
  protected readonly i18n = inject(I18n);

  readonly open = input(false);
  readonly toggled = output<void>();

  constructor() {
    // A part tapped in the 3D view: bring its card into sight (after the mobile sheet slid open)
    effect(() => {
      const id = this.store.selectedId();
      if (!id) return;
      setTimeout(() => {
        document.getElementById(`mat-${id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }, 350);
    });
  }

  protected readonly bgPalette = ['#0e0c0b', '#f6f1ea', '#1f2a44', '#2f4a3a', '#d8c3a5', '#8a8f98'];
  protected readonly palette = ['#d8c3a5', '#d9534f', '#4f8fd9', '#4fbf8f', '#f4efe9', '#2b2623'];
  protected readonly lights: { id: LightingPreset; label: TextKey }[] = [
    { id: 'studio', label: 'light.studio' },
    { id: 'front', label: 'light.front' },
    { id: 'around', label: 'light.around' },
    { id: 'sunset', label: 'light.sunset' },
  ];

  /** The screen eyedropper exists in Chrome and Edge only. */
  protected readonly canPickScreen = 'EyeDropper' in window;

  /** Typed color code: accepts "abc", "#abc" or "#aabbcc". Anything else goes back to the current color. */
  protected onHex(material: MaterialInfo, event: Event): void {
    const input = event.target as HTMLInputElement;
    const color = this.normalizeHex(input.value);
    if (color) this.store.applyColor(material.id, color);
    else input.value = material.color;
  }

  protected async pickFromScreen(id: string): Promise<void> {
    try {
      const result = await new (window as any).EyeDropper().open();
      this.store.applyColor(id, String(result.sRGBHex).toLowerCase());
    } catch {
      // the user pressed Escape, nothing to do
    }
  }

  private normalizeHex(text: string): string | null {
    let hex = text.trim().replace(/^#/, '').toLowerCase();
    if (/^[0-9a-f]{3}$/.test(hex)) hex = hex.split('').map((c) => c + c).join('');
    return /^[0-9a-f]{6}$/.test(hex) ? `#${hex}` : null;
  }

  protected onIntensity(event: Event): void {
    this.store.setLightIntensity(Number((event.target as HTMLInputElement).value));
  }

  protected onAngle(event: Event): void {
    this.store.setLightAngle(Number((event.target as HTMLInputElement).value));
  }

  protected onBackground(event: Event): void {
    this.store.setBackground((event.target as HTMLInputElement).value);
  }

  protected onColor(id: string, event: Event): void {
    this.store.setMaterialColor(id, (event.target as HTMLInputElement).value);
  }

  protected onOpacity(id: string, event: Event): void {
    this.store.setMaterialOpacity(id, Number((event.target as HTMLInputElement).value));
  }

  protected onGlow(id: string, event: Event): void {
    this.store.setMaterialGlow(id, Number((event.target as HTMLInputElement).value));
  }

  protected onClearcoat(id: string, event: Event): void {
    this.store.setMaterialClearcoat(id, Number((event.target as HTMLInputElement).value));
  }

  protected onRoughness(id: string, event: Event): void {
    this.store.setMaterialRoughness(id, Number((event.target as HTMLInputElement).value));
  }

  protected onMetalness(id: string, event: Event): void {
    this.store.setMaterialMetalness(id, Number((event.target as HTMLInputElement).value));
  }

  /** Saves the design and clears the field only if it was really saved. */
  protected async saveDesign(input: HTMLInputElement): Promise<void> {
    if (await this.store.saveDesign(input.value)) input.value = '';
  }

  protected modelLabel(design: SavedDesign): string {
    return design.modelName ?? this.store.samples.find((model) => model.id === design.model)?.name ?? design.model;
  }

  protected formatDate(timestamp: number): string {
    const locale = this.i18n.lang() === 'ar' ? 'ar-EG' : 'en-GB';
    return new Date(timestamp).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  }
}