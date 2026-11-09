import { Injectable, computed, inject, signal } from '@angular/core';
import { SAMPLE_MODELS, SampleModel } from '../models/sample-models';
import { I18n, TextKey } from '../i18n/i18n';
import { ModelDb } from '../storage/model-db';
import {
  AnimationInfo,
  AnimationState,
  HotspotFrame,
  HotspotPoint,
  LIGHT_ANGLE_RANGE,
  LIGHT_INTENSITY_RANGE,
  LightingPreset,
  MaterialChanges,
  MaterialInfo,
  MeasureFrame,
  ModelSize,
  PartInfo,
  SceneManager,
} from '../three/scene-manager';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const MAX_HISTORY = 100;
const MAX_DESIGNS = 30;
const MAX_HOTSPOTS = 30;
const MAX_MEASUREMENTS = 10;
const MAX_NOTE = 140; // characters in one note
const RECORDING_MS = 6000;

export type MaterialSettings = Required<MaterialChanges>;

export type LengthUnit = 'm' | 'cm' | 'mm' | 'in';

/** Units for the dimensions panel. Models are measured in meters (the glTF standard). */
export const LENGTH_UNITS: readonly { id: LengthUnit; label: TextKey; perMeter: number; decimals: number }[] = [
  { id: 'm', label: 'unit.m', perMeter: 1, decimals: 2 },
  { id: 'cm', label: 'unit.cm', perMeter: 100, decimals: 1 },
  { id: 'mm', label: 'unit.mm', perMeter: 1000, decimals: 0 },
  { id: 'in', label: 'unit.in', perMeter: 39.3701, decimals: 1 },
];

const LIGHTING_PRESETS: LightingPreset[] = ['studio', 'front', 'around', 'sunset'];

/** Used when a stored design has a material that doesn't look right. */
const FALLBACK_SETTINGS: MaterialSettings = {
  color: '#808080',
  roughness: 0.5,
  metalness: 0,
  opacity: 1,
  glow: 0,
  clearcoat: 0,
};

const clamp01 = (value: unknown, fallback: number): number => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : fallback;
};

/**
 * Never trusts stored or shared data. Designs saved before opacity / glow / clearcoat
 * existed simply get the default for those.
 */
function sanitizeSettings(item: any): MaterialSettings | null {
  if (!/^#[0-9a-f]{6}$/i.test(item?.color)) return null;
  return {
    color: String(item.color).toLowerCase(),
    roughness: clamp01(item.roughness, 0.5),
    metalness: clamp01(item.metalness, 0),
    opacity: clamp01(item.opacity, 1),
    glow: clamp01(item.glow, 0),
    clearcoat: clamp01(item.clearcoat, 0),
  };
}

/** A numbered point on the model with a short note. x / y / z are in the model's own coordinates. */
export interface Hotspot {
  id: string;
  x: number;
  y: number;
  z: number;
  t: string; // the note
}

/** A distance between two points of the model. `b` is null until the second point is placed. */
export interface Measurement {
  id: string;
  a: HotspotPoint;
  b: HotspotPoint | null;
}

/** The look of the scene around the model. Saved with each design. */
export interface SceneSettings {
  bg: string | null; // "#rrggbb", or null for the page background
  i: number; // light intensity multiplier
  a: number; // light direction, degrees
  h: string[]; // keys of the hidden parts (by name, not by position)
  n: Hotspot[]; // points with notes
}

const DEFAULT_SCENE: SceneSettings = { bg: null, i: 1, a: 0, h: [], n: [] };
const MAX_PARTS = 1000;

const clampRange = (value: unknown, min: number, max: number, fallback: number): number => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

/** Designs saved before the scene options existed simply get the defaults. */
function sanitizeScene(raw: any): SceneSettings {
  const hidden: string[] = Array.isArray(raw?.h)
    ? raw.h.filter((k: unknown): k is string => typeof k === 'string' && k.length <= 80).slice(0, MAX_PARTS)
    : [];

  const spots: Hotspot[] = [];
  const ids = new Set<string>();
  if (Array.isArray(raw?.n)) {
    for (const item of raw.n) {
      if (spots.length >= MAX_HOTSPOTS) break;
      const id = typeof item?.id === 'string' ? item.id.slice(0, 40) : '';
      const valid = ['x', 'y', 'z'].every((axis) => typeof item?.[axis] === 'number' && Number.isFinite(item[axis]));
      if (!id || ids.has(id) || !valid) continue;
      ids.add(id);
      spots.push({
        id,
        x: item.x,
        y: item.y,
        z: item.z,
        t: typeof item.t === 'string' ? item.t.slice(0, MAX_NOTE) : '',
      });
    }
  }

  return {
    bg: typeof raw?.bg === 'string' && /^#[0-9a-f]{6}$/i.test(raw.bg) ? raw.bg.toLowerCase() : null,
    i: clampRange(raw?.i, LIGHT_INTENSITY_RANGE.min, LIGHT_INTENSITY_RANGE.max, 1),
    a: clampRange(raw?.a, LIGHT_ANGLE_RANGE.min, LIGHT_ANGLE_RANGE.max, 0),
    h: [...new Set(hidden)].sort(),
    n: spots,
  };
}

const DESIGNS_KEY = 'modexa3d-designs';
const RECENT_KEY = 'modexa3d-recent-colors';
const MAX_RECENT = 8;
const UPLOAD_PREFIX = 'upload:'; // saved designs of uploaded files use "upload:<key>" as their model

/** A design waiting for its model to finish loading. Materials are stored by their order in the model. */
interface SharedDesign {
  m: string; // sample model id
  l: LightingPreset;
  s: MaterialSettings[];
  e?: SceneSettings; // background, light intensity / direction, hidden parts, hotspots
}

/** A design the user saved with a name. Lives in this browser only. */
export interface SavedDesign {
  id: string;
  name: string;
  model: string; // sample model id, or "upload:<key>" for a file kept in IndexedDB
  modelName?: string; // display name (the file name for uploads)
  lighting: LightingPreset;
  materials: MaterialSettings[]; // by order in the model
  scene?: SceneSettings; // missing in designs saved before these options existed
  savedAt: number;
}

interface HistoryChange {
  id: string;
  before: MaterialSettings;
  after: MaterialSettings;
}

/** A change of the scene options (background, light, hidden parts, hotspots). */
interface SceneChange {
  scene: true;
  before: SceneSettings;
  after: SceneSettings;
}

/** One undo step. Usually one change, "Reset all" produces several. */
type HistoryEntry = (HistoryChange | SceneChange)[];

@Injectable({ providedIn: 'root' })
export class ModelStore {
  private readonly i18n = inject(I18n);
  private readonly scene = new SceneManager();
  private objectUrl: string | null = null;
  private loadToken = 0;
  private sharedDesign: SharedDesign | null = null;
  private readonly db = new ModelDb();

  /** The uploaded file on screen. `key` is set once its copy exists in IndexedDB. */
  private readonly upload = signal<{ blob: Blob; name: string; key: string | null } | null>(null);

  /** Settings captured when an edit started (e.g. slider grabbed), before it is committed. */
  private readonly pending = new Map<string, MaterialSettings>();
  /** Scene options when a slider was grabbed, before the change is committed. */
  private pendingScene: SceneSettings | null = null;
  private readonly undoStack = signal<HistoryEntry[]>([]);
  private readonly redoStack = signal<HistoryEntry[]>([]);

  readonly samples = SAMPLE_MODELS;
  readonly hasModel = signal(false);
  readonly loading = signal(false);
  readonly errorMessage = signal('');
  readonly infoMessage = signal('');
  readonly activeId = signal<string | null>(null);
  readonly materials = signal<MaterialInfo[]>([]);
  /** The material the user tapped in the 3D view. */
  readonly selectedId = signal<string | null>(null);
  /** Goes up by one every time a tap on the 3D view lands on a part of the model. */
  readonly pickTick = signal(0);
  /** The mouse is over a part of the model that can be tapped. The cursor reads this. */
  readonly hoveringPart = signal(false);
  readonly lighting = signal<LightingPreset>('studio');
  readonly lightIntensity = signal(DEFAULT_SCENE.i);
  readonly lightAngle = signal(DEFAULT_SCENE.a);
  /** Scene background color, or null when the page background shows through. */
  readonly background = signal<string | null>(DEFAULT_SCENE.bg);
  /** Every mesh of the model, with its show / hide state. */
  readonly parts = signal<PartInfo[]>([]);
  readonly hiddenCount = computed(() => this.parts().filter((p) => !p.visible).length);
  readonly designs = signal<SavedDesign[]>(this.readDesigns());
  /** Colors the user picked by hand, newest first. */
  readonly recentColors = signal<string[]>(this.readRecent());

  // Before / after and dimensions
  readonly compare = signal(false);
  /** Where the divider sits, 0 (left edge) to 1 (right edge). */
  readonly comparePosition = signal(0.5);
  readonly showDimensions = signal(false);
  /** Size of the visible parts in meters, or null when there is nothing to measure. */
  readonly dimensions = signal<ModelSize | null>(null);
  readonly unit = signal<LengthUnit>('cm');

  // Hotspots (points with notes)
  readonly hotspots = signal<Hotspot[]>([]);
  /** "Add a point" mode: the next tap on the model places a hotspot. */
  readonly hotspotMode = signal(false);
  /** The hotspot whose note is open. */
  readonly activeHotspot = signal<string | null>(null);
  /** Where every hotspot is on the screen right now. */
  readonly hotspotView = signal<HotspotFrame>({ width: 0, height: 0, items: [] });

  // Measuring a distance between two points
  /** "Measure" mode: two taps on the model give the distance between them. */
  readonly measureMode = signal(false);
  readonly measurements = signal<Measurement[]>([]);
  /** Where every measurement is on the screen right now. */
  readonly measureView = signal<MeasureFrame>({ width: 0, height: 0, items: [] });
  /** The first point of a measurement is placed, the second is still missing. */
  readonly measurePending = computed(() => {
    const last = this.measurements().at(-1);
    return last !== undefined && last.b === null;
  });

  // Animations that came inside the file
  readonly animations = signal<AnimationInfo[]>([]);
  /** State of the animation bar, or null when the model does not move. */
  readonly animation = signal<AnimationState | null>(null);

  // Turntable, screenshot and video
  readonly turntable = signal(false);
  readonly recording = signal(false);
  readonly exporting = signal(false);
  readonly shotMenuOpen = signal(false);
  readonly shotScale = signal(2);
  readonly shotTransparent = signal(true);

  readonly activeModel = computed(() => this.samples.find((m) => m.id === this.activeId()) ?? null);
  readonly canUndo = computed(() => this.undoStack().length > 0);
  readonly canRedo = computed(() => this.redoStack().length > 0);
  /** Samples and uploaded files can both be saved. */
  readonly canSaveDesign = computed(() => this.hasModel() && (this.activeId() !== null || this.upload() !== null));

  constructor() {
    void this.cleanupBlobs();
  }

  /** Called by the viewer once its canvas exists. */
  attach(canvas: HTMLCanvasElement): void {
    this.scene.init(canvas);
    this.scene.setLighting(this.lighting());
    this.pushSceneSettings();
    this.scene.setAutoRotate(this.turntable());
    this.scene.setCompare(this.compare());
    this.scene.setComparePosition(this.comparePosition());
    this.scene.setDimensionsVisible(this.showDimensions());
    this.scene.setHotspotListener((frame) => this.hotspotView.set(frame));
    this.scene.setMeasureListener((frame) => this.measureView.set(frame));
    this.scene.setAnimationListener((state) => {
      this.animation.set(state);
      // The size of a moving model changes with its pose
      if (state && this.showDimensions()) this.refreshDimensions();
    });
  }

  detach(): void {
    this.scene.dispose();
    this.revokeObjectUrl();
  }

  // ---- Loading ------------------------------------------------------------

  selectSample(model: SampleModel): void {
    if (model.id === this.activeId() && this.hasModel()) return;

    const previousId = this.activeId();
    this.activeId.set(model.id);
    void this.loadUrl(model.url).then((ok) => {
      if (!ok) this.activeId.set(previousId);
      else this.upload.set(null);
    });
  }

  /** Opens the system file picker. Can be called from any button in the app. */
  openFilePicker(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.glb';
    input.style.display = 'none';

    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.remove();
      if (file) void this.loadFile(file);
    });
    input.addEventListener('cancel', () => input.remove());

    document.body.append(input);
    input.click();
  }

  /** Validates the file, then loads it. Used by both the picker and drag & drop. */
  async loadFile(file: File): Promise<void> {
    const problem = await this.validate(file);
    if (problem) {
      this.showError(problem);
      return;
    }

    await this.openBlob(file, file.name, null);
  }

  /** Loads a file from memory (fresh upload) or from IndexedDB (a saved design). */
  private async openBlob(blob: Blob, name: string, key: string | null): Promise<boolean> {
    const previousId = this.activeId();
    this.revokeObjectUrl();
    this.objectUrl = URL.createObjectURL(blob);
    this.activeId.set(null);

    const ok = await this.loadUrl(this.objectUrl);
    if (ok) this.upload.set({ blob, name, key });
    else this.activeId.set(previousId);
    return ok;
  }

  // ---- Customizing --------------------------------------------------------

  /**
   * Live setters, used while dragging a slider or a color picker.
   * They remember the starting values; call commitEdit() when the user lets go.
   */
  setMaterialColor(id: string, color: string): void {
    this.beginEdit(id);
    this.patchMaterial(id, { color });
  }

  setMaterialRoughness(id: string, roughness: number): void {
    this.beginEdit(id);
    this.patchMaterial(id, { roughness });
  }

  setMaterialMetalness(id: string, metalness: number): void {
    this.beginEdit(id);
    this.patchMaterial(id, { metalness });
  }

  setMaterialOpacity(id: string, opacity: number): void {
    this.beginEdit(id);
    this.patchMaterial(id, { opacity });
  }

  setMaterialGlow(id: string, glow: number): void {
    this.beginEdit(id);
    this.patchMaterial(id, { glow });
  }

  setMaterialClearcoat(id: string, clearcoat: number): void {
    this.beginEdit(id);
    this.patchMaterial(id, { clearcoat });
  }

  /** Ends the current edit and records it as ONE undo step. */
  commitEdit(id: string, remember = true): void {
    const before = this.pending.get(id);
    this.pending.delete(id);
    const after = this.settingsOf(id);
    if (!before || !after || this.same(before, after)) return;

    this.pushHistory([{ id, before, after }]);
    if (remember && before.color !== after.color) this.rememberColor(after.color);
  }

  /** One-click change from a ready-made swatch. One undo step, not added to "recent". */
  quickSetColor(id: string, color: string): void {
    this.setMaterialColor(id, color);
    this.commitEdit(id, false);
  }

  /** A color chosen by hand (hex field, eyedropper). One undo step, added to "recent". */
  applyColor(id: string, color: string): void {
    this.setMaterialColor(id, color);
    this.commitEdit(id);
  }

  resetMaterial(id: string): void {
    const before = this.settingsOf(id);
    this.replaceMaterial(id, this.scene.resetMaterial(id));
    const after = this.settingsOf(id);
    if (before && after && !this.same(before, after)) {
      this.pushHistory([{ id, before, after }]);
    }
  }

  resetAllMaterials(): void {
    const before = new Map(this.materials().map((m) => [m.id, this.pick(m)]));
    const updated = this.scene.resetAllMaterials();
    this.materials.set(updated);

    const changes: HistoryEntry = [];
    for (const material of updated) {
      const old = before.get(material.id);
      const now = this.pick(material);
      if (old && !this.same(old, now)) changes.push({ id: material.id, before: old, after: now });
    }
    if (changes.length) this.pushHistory(changes);
  }

  /** True when the point is over a part of the model. Used to change the mouse cursor. */
  partAt(clientX: number, clientY: number): boolean {
    return this.hasModel() && this.scene.pick(clientX, clientY) !== null;
  }

  /** A tap on the 3D view: selects the material under it, or nothing when it hit empty space. */
  pickAt(clientX: number, clientY: number): void {
    if (!this.hasModel()) return;
    const id = this.scene.pick(clientX, clientY);
    this.selectedId.set(id);
    // Lets the page open the customize panel even when the same part was tapped again
    if (id) this.pickTick.update((n) => n + 1);
  }

  setLighting(preset: LightingPreset): void {
    this.lighting.set(preset);
    this.scene.setLighting(preset);
  }

  // Scene options. The live setters are used while dragging; call commitSceneEdit() on release.
  setLightIntensity(value: number): void {
    this.beginSceneEdit();
    this.lightIntensity.set(value);
    this.scene.setLightIntensity(value);
  }

  setLightAngle(degrees: number): void {
    this.beginSceneEdit();
    this.lightAngle.set(degrees);
    this.scene.setLightAngle(degrees);
  }

  setBackground(color: string | null): void {
    this.beginSceneEdit();
    this.background.set(color);
    this.scene.setBackground(color);
  }

  /** One-click background change (swatch or "Default"): one undo step. */
  quickSetBackground(color: string | null): void {
    this.setBackground(color);
    this.commitSceneEdit();
  }

  /** Ends the current scene edit and records it as ONE undo step. */
  commitSceneEdit(): void {
    const before = this.pendingScene;
    this.pendingScene = null;
    const after = this.currentScene();
    if (before && !this.sameScene(before, after)) this.pushHistory([{ scene: true, before, after }]);
  }

  /** Back to the default background, brightness and direction. */
  resetScene(): void {
    this.beginSceneEdit();
    this.background.set(DEFAULT_SCENE.bg);
    this.lightIntensity.set(DEFAULT_SCENE.i);
    this.lightAngle.set(DEFAULT_SCENE.a);
    this.pushSceneSettings();
    this.commitSceneEdit();
  }

  togglePart(index: number): void {
    const part = this.parts().find((p) => p.index === index);
    if (!part) return;
    this.beginSceneEdit();
    this.scene.setPartVisible(index, !part.visible);
    this.parts.set(this.scene.getParts());
    this.refreshDimensions();
    this.dropSelectionIfHidden();
    this.commitSceneEdit();
  }

  showAllParts(): void {
    this.beginSceneEdit();
    this.scene.setHiddenParts([]);
    this.parts.set(this.scene.getParts());
    this.refreshDimensions();
    this.commitSceneEdit();
  }

  private beginSceneEdit(): void {
    this.pendingScene ??= this.currentScene();
  }

  private sameScene(a: SceneSettings, b: SceneSettings): boolean {
    return (
      a.bg === b.bg &&
      a.i === b.i &&
      a.a === b.a &&
      a.h.join('|') === b.h.join('|') &&
      JSON.stringify(a.n) === JSON.stringify(b.n)
    );
  }

  /** The scene options as they are right now. */
  private currentScene(): SceneSettings {
    return {
      bg: this.background(),
      i: this.lightIntensity(),
      a: this.lightAngle(),
      h: this.parts().filter((p) => !p.visible).map((p) => p.key).sort(),
      n: this.hotspots().map((spot) => ({ ...spot })),
    };
  }

  /** Applies saved scene options. Parts need the model to be loaded already. */
  private applyScene(raw: SceneSettings | undefined): void {
    const settings = sanitizeScene(raw ?? DEFAULT_SCENE);
    this.background.set(settings.bg);
    this.lightIntensity.set(settings.i);
    this.lightAngle.set(settings.a);
    this.pushSceneSettings();
    this.scene.setHiddenParts(settings.h);
    this.parts.set(this.scene.getParts());
    this.refreshDimensions();
    this.dropSelectionIfHidden();

    this.hotspots.set(settings.n);
    this.scene.setHotspots(settings.n);
    if (this.activeHotspot() && !settings.n.some((spot) => spot.id === this.activeHotspot())) {
      this.activeHotspot.set(null);
    }
  }

  /** Sends the current signal values to the 3D scene. */
  private pushSceneSettings(): void {
    this.scene.setBackground(this.background());
    this.scene.setLightIntensity(this.lightIntensity());
    this.scene.setLightAngle(this.lightAngle());
  }

  private dropSelectionIfHidden(): void {
    const id = this.selectedId();
    if (!id) return;
    // A material stays selectable while any visible part still uses it
    if (!this.scene.isMaterialVisible(id)) this.selectedId.set(null);
  }

  // ---- Hotspots -----------------------------------------------------------

  /** Turns "add a point" mode on or off. While it is on, the next tap on the model places a point. */
  toggleHotspotMode(): void {
    if (!this.hasModel()) return;
    this.stopMeasuring();
    this.selectHotspot(null);
    this.hotspotMode.update((on) => !on);
  }

  /** Places a numbered point where the model was tapped, and opens its note. */
  addHotspotAt(clientX: number, clientY: number): void {
    if (!this.hasModel()) return;

    if (this.hotspots().length >= MAX_HOTSPOTS) {
      this.hotspotMode.set(false);
      this.showError(this.i18n.t('msg.hotspotLimit', { n: MAX_HOTSPOTS }));
      return;
    }

    const point = this.scene.pointOnModel(clientX, clientY);
    if (!point) return; // the tap missed the model: stay in add mode

    this.beginSceneEdit();
    const spot: Hotspot = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      ...point,
      t: '',
    };
    this.hotspots.update((list) => [...list, spot]);
    this.scene.setHotspots(this.hotspots());
    this.commitSceneEdit();

    this.hotspotMode.set(false);
    this.activeHotspot.set(spot.id);
  }

  /** Opens the note of a point, or closes it with null. */
  selectHotspot(id: string | null): void {
    this.commitSceneEdit(); // a note being typed counts as one undo step once it is closed
    this.activeHotspot.set(id);
  }

  hotspotText(id: string): string {
    return this.hotspots().find((spot) => spot.id === id)?.t ?? '';
  }

  /** Live while typing. Call commitSceneEdit() when the field loses focus. */
  setHotspotText(id: string, text: string): void {
    this.beginSceneEdit();
    const note = text.slice(0, MAX_NOTE);
    this.hotspots.update((list) => list.map((spot) => (spot.id === id ? { ...spot, t: note } : spot)));
  }

  deleteHotspot(id: string): void {
    this.beginSceneEdit();
    this.hotspots.update((list) => list.filter((spot) => spot.id !== id));
    this.scene.setHotspots(this.hotspots());
    if (this.activeHotspot() === id) this.activeHotspot.set(null);
    this.commitSceneEdit();
  }

  // ---- Measuring ----------------------------------------------------------

  /** Turns "measure" mode on or off. While it is on, two taps on the model give the distance between them. */
  toggleMeasureMode(): void {
    if (!this.hasModel()) return;
    if (this.measureMode()) {
      this.stopMeasuring();
      return;
    }
    this.hotspotMode.set(false);
    this.selectHotspot(null);
    this.measureMode.set(true);
  }

  /** Leaves measure mode. A measurement that only has its first point is dropped. */
  stopMeasuring(): void {
    this.measureMode.set(false);
    if (this.measurePending()) {
      this.measurements.update((list) => list.slice(0, -1));
      this.scene.setMeasurements(this.measurements());
    }
  }

  /** A tap in measure mode: the first tap places point A, the second places point B and shows the distance. */
  addMeasurePointAt(clientX: number, clientY: number): void {
    if (!this.hasModel()) return;

    const list = this.measurements();
    const last = list.at(-1);
    const waitingForSecond = last !== undefined && last.b === null;

    if (!waitingForSecond && list.length >= MAX_MEASUREMENTS) {
      this.measureMode.set(false);
      this.showError(this.i18n.t('msg.measureLimit', { n: MAX_MEASUREMENTS }));
      return;
    }

    const point = this.scene.pointOnModel(clientX, clientY);
    if (!point) return; // the tap missed the model: stay in measure mode

    if (waitingForSecond && last) {
      this.measurements.set([...list.slice(0, -1), { ...last, b: point }]);
    } else {
      const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      this.measurements.set([...list, { id, a: point, b: null }]);
    }
    this.scene.setMeasurements(this.measurements());
  }

  clearMeasurements(): void {
    this.measurements.set([]);
    this.scene.setMeasurements([]);
  }

  // ---- Animations ---------------------------------------------------------

  selectAnimation(index: number): void {
    this.scene.selectAnimation(index);
  }

  toggleAnimation(): void {
    const state = this.animation();
    if (state) this.scene.setAnimationPlaying(!state.playing);
  }

  /** Dragging the timeline pauses the animation, so the slider and the playback do not fight each other. */
  seekAnimation(seconds: number): void {
    this.scene.setAnimationPlaying(false);
    this.scene.seekAnimation(seconds);
  }

  setAnimationSpeed(speed: number): void {
    this.scene.setAnimationSpeed(speed);
  }

  toggleAnimationLoop(): void {
    const state = this.animation();
    if (state) this.scene.setAnimationLoop(!state.loop);
  }

  // ---- Before / after and dimensions --------------------------------------

  /** Splits the view: the original file on the left, the edited model on the right. */
  toggleCompare(): void {
    if (!this.hasModel()) return;
    const enabled = !this.compare();
    this.compare.set(enabled);
    this.scene.setCompare(enabled);
  }

  setComparePosition(fraction: number): void {
    const clamped = Math.min(0.98, Math.max(0.02, fraction));
    this.comparePosition.set(clamped);
    this.scene.setComparePosition(clamped);
  }

  toggleDimensions(): void {
    if (!this.hasModel()) return;
    const enabled = !this.showDimensions();
    this.showDimensions.set(enabled);
    this.scene.setDimensionsVisible(enabled);
    if (enabled) this.refreshDimensions();
  }

  setUnit(unit: LengthUnit): void {
    this.unit.set(unit);
  }

  /** Measures the visible parts again (after loading, after a part was shown or hidden, or while a model moves). */
  private refreshDimensions(): void {
    this.dimensions.set(this.scene.updateDimensions());
  }

  // ---- Saved designs ------------------------------------------------------

  /** Saves the current look under a name. Returns false when nothing was saved. */
  async saveDesign(name: string): Promise<boolean> {
    if (!this.canSaveDesign()) return false;

    const target = await this.storeCurrentModel();
    if (!target) return false;

    const design: SavedDesign = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim().slice(0, 40) || this.i18n.t('cz.defaultName', { n: this.designs().length + 1 }),
      model: target.key,
      modelName: target.label,
      lighting: this.lighting(),
      materials: this.materials().map((m) => this.pick(m)),
      scene: this.currentScene(),
      savedAt: Date.now(),
    };

    this.designs.update((list) => [design, ...list].slice(0, MAX_DESIGNS));
    this.persistDesigns();
    void this.cleanupBlobs(); // the 30 designs limit may have dropped an old one
    this.showInfo(this.i18n.t('msg.designSaved'));
    return true;
  }

  /** A sample is saved by its id. An uploaded file is copied into IndexedDB first (only once). */
  private async storeCurrentModel(): Promise<{ key: string; label: string } | null> {
    const sampleId = this.activeId();
    if (sampleId) return { key: sampleId, label: this.activeModel()?.name ?? sampleId };

    const upload = this.upload();
    if (!upload) return null;

    if (!upload.key) {
      const key = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      try {
        await this.db.put({ id: key, name: upload.name, blob: upload.blob, savedAt: Date.now() });
      } catch (error) {
        console.error('Could not store the uploaded file', error);
        this.showError(this.i18n.t('msg.saveFail'));
        return null;
      }
      this.upload.set({ ...upload, key });
      return { key: `${UPLOAD_PREFIX}${key}`, label: upload.name };
    }

    return { key: `${UPLOAD_PREFIX}${upload.key}`, label: upload.name };
  }

  async loadDesign(id: string): Promise<void> {
    const design = this.designs().find((d) => d.id === id);
    if (!design) return;

    if (design.model.startsWith(UPLOAD_PREFIX)) {
      await this.loadUploadedDesign(design);
      return;
    }

    const sample = this.samples.find((s) => s.id === design.model);
    if (!sample) return;

    this.setLighting(design.lighting);

    if (this.activeId() === design.model && this.hasModel()) {
      this.applyToCurrentModel(design.materials, design.scene);
    } else {
      // Different model: load it first, the colors are applied right after it's ready
      this.sharedDesign = { m: design.model, l: design.lighting, s: design.materials, e: design.scene };
      this.selectSample(sample);
    }
    this.showInfo(this.i18n.t('msg.designLoaded'));
  }

  /** The design belongs to an uploaded file: bring the file back from IndexedDB. */
  private async loadUploadedDesign(design: SavedDesign): Promise<void> {
    const key = design.model.slice(UPLOAD_PREFIX.length);

    // The same file is already on screen
    if (this.activeId() === null && this.upload()?.key === key && this.hasModel()) {
      this.setLighting(design.lighting);
      this.applyToCurrentModel(design.materials, design.scene);
      this.showInfo(this.i18n.t('msg.designLoaded'));
      return;
    }

    let record;
    try {
      record = await this.db.get(key);
    } catch {
      record = undefined;
    }
    if (!record) {
      this.showError(this.i18n.t('msg.designMissing'));
      return;
    }

    this.setLighting(design.lighting);
    this.sharedDesign = { m: design.model, l: design.lighting, s: design.materials, e: design.scene };
    const ok = await this.openBlob(record.blob, record.name, key);
    if (ok) this.showInfo(this.i18n.t('msg.designLoaded'));
  }

  deleteDesign(id: string): void {
    this.designs.update((list) => list.filter((d) => d.id !== id));
    this.persistDesigns();
    void this.cleanupBlobs();
  }

  /** Removes stored files that no saved design uses anymore. */
  private async cleanupBlobs(): Promise<void> {
    try {
      const used = new Set(
        this.designs()
          .filter((d) => d.model.startsWith(UPLOAD_PREFIX))
          .map((d) => d.model.slice(UPLOAD_PREFIX.length)),
      );
      for (const key of await this.db.keys()) {
        if (!used.has(key)) await this.db.delete(key);
      }
      // If the file on screen lost its copy, the next save stores it again
      const upload = this.upload();
      if (upload?.key && !used.has(upload.key)) this.upload.set({ ...upload, key: null });
    } catch {
      // storage unavailable: nothing to clean
    }
  }

  /** Same model is already on screen: apply the colors and make it ONE undo step. */
  private applyToCurrentModel(settings: MaterialSettings[], scene: SceneSettings | undefined): void {
    const before = new Map(this.materials().map((m) => [m.id, this.pick(m)]));
    const sceneBefore = this.currentScene();

    this.materials().forEach((material, index) => {
      const next = settings[index];
      if (next) this.scene.updateMaterial(material.id, next);
    });

    const updated = this.scene.getMaterials();
    this.materials.set(updated);

    const changes: HistoryEntry = [];
    for (const material of updated) {
      const old = before.get(material.id);
      const now = this.pick(material);
      if (old && !this.same(old, now)) changes.push({ id: material.id, before: old, after: now });
    }

    this.applyScene(scene);
    const sceneAfter = this.currentScene();
    if (!this.sameScene(sceneBefore, sceneAfter)) {
      changes.push({ scene: true, before: sceneBefore, after: sceneAfter });
    }
    if (changes.length) this.pushHistory(changes);
  }

  private persistDesigns(): void {
    try {
      localStorage.setItem(DESIGNS_KEY, JSON.stringify(this.designs()));
    } catch {
      // storage can be full or blocked, the designs still work until the page closes
    }
  }

  /** Never trusts what's in storage: anything that doesn't look right is dropped. */
  private readDesigns(): SavedDesign[] {
    try {
      const raw = localStorage.getItem(DESIGNS_KEY);
      return this.sanitizeDesigns(raw ? JSON.parse(raw) : []);
    } catch {
      return [];
    }
  }

  /** Designs that come from the cloud (as JSON text). Anything that doesn't look right is dropped. */
  parseDesigns(json: unknown): SavedDesign[] {
    if (typeof json !== 'string') return [];
    try {
      return this.sanitizeDesigns(JSON.parse(json));
    } catch {
      return [];
    }
  }

  /** Used by the cloud sync: replaces the saved designs and keeps the copy on this device in step. */
  replaceDesigns(list: SavedDesign[]): void {
    this.designs.set(list.slice(0, MAX_DESIGNS));
    this.persistDesigns();
    void this.cleanupBlobs();
  }

  /** Used by the cloud sync: replaces the list of recent colors. */
  setRecentColors(list: string[]): void {
    const colors = list.filter((c) => /^#[0-9a-f]{6}$/i.test(c)).map((c) => c.toLowerCase()).slice(0, MAX_RECENT);
    this.recentColors.set(colors);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(colors));
    } catch {
      // storage can be blocked, the list still works until the page closes
    }
  }

  private sanitizeDesigns(data: unknown): SavedDesign[] {
    try {
      if (!Array.isArray(data)) return [];

      return data
        .filter(
          (d: any) =>
            typeof d?.id === 'string' &&
            typeof d?.name === 'string' &&
            typeof d?.model === 'string' &&
            LIGHTING_PRESETS.includes(d?.lighting) &&
            Array.isArray(d?.materials) &&
            (d?.modelName === undefined || typeof d.modelName === 'string'),
        )
        .slice(0, MAX_DESIGNS)
        .map((d: any) => ({
          ...d,
          materials: d.materials.map((m: unknown) => sanitizeSettings(m) ?? FALLBACK_SETTINGS),
          scene: d.scene ? sanitizeScene(d.scene) : undefined,
        }));
    } catch {
      return [];
    }
  }

  // ---- Recent colors ------------------------------------------------------

  private rememberColor(color: string): void {
    this.recentColors.update((list) => [color, ...list.filter((c) => c !== color)].slice(0, MAX_RECENT));
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(this.recentColors()));
    } catch {
      // storage can be blocked, the list still works until the page closes
    }
  }

  private readRecent(): string[] {
    try {
      const data = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
      if (!Array.isArray(data)) return [];
      return data.filter((c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)).slice(0, MAX_RECENT);
    } catch {
      return [];
    }
  }

  // ---- Turntable, screenshot, video, export -------------------------------

  toggleTurntable(): void {
    const enabled = !this.turntable();
    this.turntable.set(enabled);
    this.scene.setAutoRotate(enabled);
  }

  toggleShotMenu(): void {
    this.shotMenuOpen.update((open) => !open);
  }

  async takeScreenshot(): Promise<void> {
    if (!this.hasModel()) return;

    try {
      const blob = await this.scene.capture(this.shotScale(), this.shotTransparent());
      this.download(blob, `${this.fileBaseName()}.png`);
      this.shotMenuOpen.set(false);
      this.showInfo(this.i18n.t('msg.shotSaved'));
    } catch (error) {
      console.error('Screenshot failed', error);
      this.showError(this.i18n.t('msg.shotFail'));
    }
  }

  /** Downloads the model with the current colors and materials as a new .glb. Works for samples and uploads. */
  async exportModel(): Promise<void> {
    if (!this.hasModel() || this.exporting()) return;

    this.exporting.set(true);
    try {
      const blob = await this.scene.exportGlb();
      this.download(blob, `${this.exportBaseName()}-edited.glb`);
      this.showInfo(this.i18n.t('msg.exported'));
    } catch (error) {
      console.error('Export failed', error);
      this.showError(this.i18n.t('msg.exportFail'));
    } finally {
      this.exporting.set(false);
    }
  }

  async recordTurntable(): Promise<void> {
    if (!this.hasModel() || this.recording()) return;

    this.shotMenuOpen.set(false);
    this.recording.set(true);
    this.showInfo(this.i18n.t('msg.recording'));

    try {
      const blob = await this.scene.recordTurn(RECORDING_MS);
      this.download(blob, `${this.fileBaseName()}-turntable.webm`);
      this.showInfo(this.i18n.t('msg.videoSaved'));
    } catch (error) {
      console.error('Recording failed', error);
      this.showError(this.i18n.t('msg.recordFail'));
    } finally {
      this.recording.set(false);
    }
  }

  /** The uploaded file's name without ".glb", or the sample's id. */
  private exportBaseName(): string {
    const uploaded = this.upload()?.name;
    if (this.activeId() === null && uploaded) return uploaded.replace(/\.glb$/i, '') || 'model';
    return this.activeId() ?? 'model';
  }

  private fileBaseName(): string {
    return `modexa3d-${this.activeId() ?? 'model'}`;
  }

  private download(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---- History ------------------------------------------------------------

  undo(): void {
    const entry = this.undoStack().at(-1);
    if (!entry) return;

    this.undoStack.update((stack) => stack.slice(0, -1));
    this.redoStack.update((stack) => [...stack, entry]);
    this.applyEntry(entry, 'before');
  }

  redo(): void {
    const entry = this.redoStack().at(-1);
    if (!entry) return;

    this.redoStack.update((stack) => stack.slice(0, -1));
    this.undoStack.update((stack) => [...stack, entry]);
    this.applyEntry(entry, 'after');
  }

  private pushHistory(entry: HistoryEntry): void {
    this.undoStack.update((stack) => [...stack, entry].slice(-MAX_HISTORY));
    this.redoStack.set([]); // a new change invalidates the redo branch
  }

  private clearHistory(): void {
    this.undoStack.set([]);
    this.redoStack.set([]);
    this.pending.clear();
    this.pendingScene = null;
  }

  private applyEntry(entry: HistoryEntry, side: 'before' | 'after'): void {
    for (const change of entry) {
      if ('scene' in change) this.applyScene(change[side]);
      else this.replaceMaterial(change.id, this.scene.updateMaterial(change.id, change[side]));
    }
  }

  // ---- Internals ----------------------------------------------------------

  /** Applies a waiting design's colors and scene options once the model's materials exist. */
  private applySharedDesign(): void {
    const design = this.sharedDesign;
    this.sharedDesign = null;
    if (!design) return;

    this.materials().forEach((material, index) => {
      const settings = design.s[index];
      if (settings) this.scene.updateMaterial(material.id, settings);
    });
    this.materials.set(this.scene.getMaterials());
    this.applyScene(design.e);
  }

  private beginEdit(id: string): void {
    if (this.pending.has(id)) return;
    const settings = this.settingsOf(id);
    if (settings) this.pending.set(id, settings);
  }

  private settingsOf(id: string): MaterialSettings | null {
    const material = this.materials().find((m) => m.id === id);
    return material ? this.pick(material) : null;
  }

  private pick(material: MaterialInfo): MaterialSettings {
    return {
      color: material.color,
      roughness: material.roughness,
      metalness: material.metalness,
      opacity: material.opacity,
      glow: material.glow,
      clearcoat: material.clearcoat,
    };
  }

  private same(a: MaterialSettings, b: MaterialSettings): boolean {
    return (
      a.color === b.color &&
      a.roughness === b.roughness &&
      a.metalness === b.metalness &&
      a.opacity === b.opacity &&
      a.glow === b.glow &&
      a.clearcoat === b.clearcoat
    );
  }

  private patchMaterial(id: string, changes: MaterialChanges): void {
    this.replaceMaterial(id, this.scene.updateMaterial(id, changes));
  }

  private replaceMaterial(id: string, info: MaterialInfo | undefined): void {
    if (!info) return;
    this.materials.update((list) => list.map((m) => (m.id === id ? info : m)));
  }

  private async validate(file: File): Promise<string | null> {
    if (!file.name.toLowerCase().endsWith('.glb')) {
      return this.i18n.t('msg.onlyGlb');
    }
    if (file.size > MAX_FILE_SIZE) {
      return this.i18n.t('msg.tooLarge');
    }
    // Every real GLB file starts with the bytes "glTF"
    const magic = await file.slice(0, 4).text();
    if (magic !== 'glTF') {
      return this.i18n.t('msg.invalidGlb');
    }
    return null;
  }

  /** Returns false only when this load failed. */
  private async loadUrl(url: string): Promise<boolean> {
    const token = ++this.loadToken;
    this.loading.set(true);
    this.errorMessage.set('');

    try {
      const applied = await this.scene.load(url);
      if (applied) {
        this.materials.set(this.scene.getMaterials());
        this.parts.set(this.scene.getParts());

        // Points, notes and measurements belong to the previous model
        this.hotspots.set([]);
        this.scene.setHotspots([]);
        this.activeHotspot.set(null);
        this.hotspotMode.set(false);
        this.measurements.set([]);
        this.scene.setMeasurements([]);
        this.measureMode.set(false);

        // The animations of the new file (the bar itself is updated by the scene)
        this.animations.set(this.scene.getAnimations());

        this.applySharedDesign();
        this.refreshDimensions();
        this.clearHistory(); // history belongs to the previous model
        this.selectedId.set(null);
        this.hasModel.set(true);
      }
      return true;
    } catch (error) {
      console.error('Failed to load model', error);
      if (token === this.loadToken) {
        this.sharedDesign = null;
        this.showError(this.i18n.t('msg.loadFail'));
      }
      return false;
    } finally {
      if (token === this.loadToken) this.loading.set(false);
    }
  }

  private showError(message: string): void {
    this.errorMessage.set(message);
    setTimeout(() => {
      if (this.errorMessage() === message) this.errorMessage.set('');
    }, 6000);
  }

  private showInfo(message: string): void {
    this.infoMessage.set(message);
    setTimeout(() => {
      if (this.infoMessage() === message) this.infoMessage.set('');
    }, 2500);
  }

  private revokeObjectUrl(): void {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }
}