import {
  ACESFilmicToneMapping,
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  Box3,
  Box3Helper,
  Clock,
  Color,
  DirectionalLight,
  LineBasicMaterial,
  LoadingManager,
  LoopOnce,
  LoopRepeat,
  Material,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PMREMGenerator,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Texture,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { FBXLoader } from 'three/addons/loaders/FBXLoader.js'; // the loader itself is loaded on demand
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { clone as cloneObject } from 'three/addons/utils/SkeletonUtils.js';

export type LightingPreset = 'studio' | 'front' | 'around' | 'sunset';

/** The 3D file formats the viewer can open. */
export type ModelFormat = 'glb' | 'fbx';

export interface MaterialInfo {
  readonly id: string;
  readonly name: string;
  readonly color: string; // "#rrggbb"
  readonly roughness: number;
  readonly metalness: number;
  readonly opacity: number; // 1 = solid, 0 = invisible
  readonly glow: number; // 0 = off, the surface lights itself in its own color
  readonly clearcoat: number; // 0 = none, 1 = glossy varnish on top
}

/** One mesh of the model that can be shown or hidden. */
export interface PartInfo {
  readonly index: number;
  readonly key: string; // stable id (name + repeat count), survives a different mesh order
  readonly name: string;
  readonly visible: boolean;
}

/** Size of the visible parts, in the model's own units (glTF uses meters). */
export interface ModelSize {
  readonly width: number; // x
  readonly height: number; // y
  readonly depth: number; // z
}

/** A spot on the model's surface, in the model's own coordinates (so it follows the model). */
export interface HotspotPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Where a hotspot is on the screen right now (CSS pixels, from the canvas top-left corner). */
export interface HotspotScreen {
  readonly id: string;
  readonly number: number; // 1, 2, 3 ... in the order they were added
  readonly x: number;
  readonly y: number;
  readonly occluded: boolean; // behind the model, seen from the camera
}

export interface HotspotFrame {
  readonly width: number; // canvas size, so the page can keep note bubbles inside it
  readonly height: number;
  readonly items: HotspotScreen[];
}

/** One end of a measurement, on the screen. */
export interface MeasureScreenPoint {
  readonly x: number;
  readonly y: number;
  readonly occluded: boolean;
}

/** One measurement on the screen. `b` is null while the second point has not been placed yet. */
export interface MeasureScreenItem {
  readonly id: string;
  readonly a: MeasureScreenPoint;
  readonly b: MeasureScreenPoint | null;
  readonly meters: number; // distance between the two points (0 while `b` is null)
}

export interface MeasureFrame {
  readonly width: number;
  readonly height: number;
  readonly items: MeasureScreenItem[];
}

/** One animation that came inside the .glb file. */
export interface AnimationInfo {
  readonly index: number;
  readonly name: string; // empty when the file gave it no name
  readonly duration: number; // seconds
}

/** What the animation bar needs to draw itself. */
export interface AnimationState {
  readonly index: number;
  readonly time: number; // seconds
  readonly duration: number;
  readonly playing: boolean;
  readonly speed: number;
  readonly loop: boolean;
}

export const LIGHT_INTENSITY_RANGE = { min: 0.2, max: 2.5 } as const;
export const LIGHT_ANGLE_RANGE = { min: -180, max: 180 } as const; // degrees
export const ANIMATION_SPEED_RANGE = { min: 0.1, max: 3 } as const;

export type MaterialChanges = Partial<
  Pick<MaterialInfo, 'color' | 'roughness' | 'metalness' | 'opacity' | 'glow' | 'clearcoat'>
>;

interface MaterialEntry {
  material: MeshStandardMaterial;
  name: string;
  glow: number;
  // What the model came with, so glow 0 puts everything back exactly as it was
  baseEmissive: Color;
  baseEmissiveIntensity: number;
  baseEmissiveMap: Texture | null;
  baseTransparent: boolean;
  original: Required<MaterialChanges>;
}

interface MeasureItem {
  id: string;
  a: HotspotPoint;
  b: HotspotPoint | null;
}

/** What a loader gives back: the model and the animations that came inside the file. */
interface LoadedModel {
  root: Object3D;
  animations: AnimationClip[];
}

const MAX_CAPTURE_SIZE = 4096; // longest side of a screenshot, in pixels
const BACKGROUND = '#0e0c0b';
const OCCLUSION_INTERVAL_MS = 120; // checking what hides a hotspot is costly, so not on every frame
const MAX_ANIMATION_STEP = 0.1; // seconds. A long pause (hidden tab) must not make the animation jump

// Most FBX files are written in centimeters. A model larger than this many units is taken as centimeters
// and scaled by 0.01, so its size in the dimensions panel comes out in meters like a GLB.
const FBX_CM_THRESHOLD = 10;
const FBX_CM_SCALE = 0.01;

// The edited model lives on layer 0, the untouched copy ("before") on layer 1
const AFTER_LAYER = 0;
const BEFORE_LAYER = 1;

const LIGHTING: Record<
  LightingPreset,
  {
    envIntensity: number;
    envRotation: number;
    keyIntensity: number;
    keyColor: number;
    keyPosition: [number, number, number];
  }
> = {
  studio: { envIntensity: 1, envRotation: 0, keyIntensity: 1.5, keyColor: 0xffffff, keyPosition: [3, 5, 4] },
  front: { envIntensity: 0.55, envRotation: 0, keyIntensity: 2.6, keyColor: 0xffffff, keyPosition: [0, 2, 6] },
  around: { envIntensity: 1.7, envRotation: Math.PI, keyIntensity: 0.4, keyColor: 0xffffff, keyPosition: [-3, 5, -4] },
  sunset: { envIntensity: 0.7, envRotation: Math.PI / 2, keyIntensity: 2.8, keyColor: 0xffa566, keyPosition: [-5, 1.5, 3] },
};

export class SceneManager {
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(40, 1, 0.01, 1000);
  private readonly loader = new GLTFLoader();
  private fbxLoader: FBXLoader | null = null;
  private fbxTexturesFailed = false;
  private textureErrorListener?: () => void;
  private readonly keyLight = new DirectionalLight(0xffffff, 1.5);
  private readonly entries = new Map<string, MaterialEntry>();
  private readonly clock = new Clock();
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly renderSize = new Vector2();
  private readonly rayDirection = new Vector3();
  private readonly sizeBox = new Box3Helper(new Box3(), 0xd8c3a5);

  private renderer?: WebGLRenderer;
  private controls?: OrbitControls;
  private resizeObserver?: ResizeObserver;
  private envTexture?: Texture;
  private model: Object3D | null = null;
  private beforeModel: Object3D | null = null; // untouched copy, shown on the left in compare mode
  private modelOrigin = new Vector3(); // where the file placed the model, before it was centered
  private parts: Mesh[] = [];
  private partKeys: string[] = [];
  private preset: LightingPreset = 'studio';
  private lightIntensity = 1; // multiplies the preset's brightness
  private lightAngle = 0; // radians, turns the lights around the model
  private backgroundColor: string | null = null; // null = the page's own background shows through
  private compareOn = false;
  private comparePos = 0.5; // 0..1 from the left edge of the canvas
  private dimensionsOn = false;
  private hotspotIds: { id: string; point: HotspotPoint }[] = [];
  private hotspotListener?: (frame: HotspotFrame) => void;
  private hotspotKey = '';
  private readonly occlusion = new Map<string, boolean>();
  private occlusionAt = 0;

  // Measurements (two points and the distance between them)
  private measureItems: MeasureItem[] = [];
  private measureListener?: (frame: MeasureFrame) => void;
  private measureKey = '';
  private readonly measureOcclusion = new Map<string, boolean>();
  private measureOcclusionAt = 0;

  // Animations that came inside the file. The "before" copy has its own mixer, kept in step with the real one.
  private clips: AnimationClip[] = [];
  private mixer: AnimationMixer | null = null;
  private beforeMixer: AnimationMixer | null = null;
  private action: AnimationAction | null = null;
  private beforeAction: AnimationAction | null = null;
  private animIndex = 0;
  private animPlaying = false;
  private animSpeed = 1;
  private animLoop = true;
  private animationListener?: (state: AnimationState | null) => void;
  private animationKey = '';

  private frameId = 0;
  private loadId = 0;

  /** Creates the renderer, lights, controls and starts the render loop. */
  init(canvas: HTMLCanvasElement): void {
    const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer = renderer;

    // Soft studio lighting from a built-in environment
    const pmrem = new PMREMGenerator(renderer);
    this.envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.envTexture;

    this.keyLight.layers.enable(BEFORE_LAYER); // the light must reach both copies of the model
    this.scene.add(this.keyLight);
    this.setLighting('studio');

    // Box around the visible parts, drawn on top of the model
    const lineMaterial = this.sizeBox.material as LineBasicMaterial;
    lineMaterial.depthTest = false;
    lineMaterial.transparent = true;
    lineMaterial.opacity = 0.9;
    lineMaterial.toneMapped = false;
    this.sizeBox.renderOrder = 10;
    this.sizeBox.visible = false;
    this.sizeBox.layers.enable(BEFORE_LAYER);
    this.scene.add(this.sizeBox);

    this.camera.position.set(3, 2, 3);

    const controls = new OrbitControls(this.camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.autoRotate = false;
    controls.autoRotateSpeed = 2;
    this.controls = controls;

    // Keep the canvas sharp when its container changes size
    const resize = () => {
      const { clientWidth: width, clientHeight: height } = canvas;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    };
    this.resizeObserver = new ResizeObserver(resize);
    this.resizeObserver.observe(canvas);
    resize();

    this.clock.start();
    const tick = () => {
      this.frameId = requestAnimationFrame(tick);
      // Passing the elapsed time makes auto-rotation the same speed on any screen refresh rate
      const delta = this.clock.getDelta();
      controls.update(delta);
      this.advanceAnimation(delta);
      this.renderFrame();
      this.updateHotspots();
      this.updateMeasurements();
      this.updateAnimationState();
    };
    tick();
  }

  /**
   * Loads a .glb or .fbx from a URL (or blob URL), replaces the old model and frames it.
   * Returns false when a newer load request superseded this one.
   */
  async load(url: string, format: ModelFormat = 'glb'): Promise<boolean> {
    if (!this.renderer) throw new Error('SceneManager is not initialised');

    const requestId = ++this.loadId;
    const loaded = format === 'fbx' ? await this.loadFbx(url) : await this.loadGlb(url);

    if (requestId !== this.loadId) {
      this.disposeObject(loaded.root);
      return false;
    }

    this.removeModel();
    this.model = loaded.root;
    this.scene.add(loaded.root);
    this.collectMaterials(loaded.root);
    this.collectParts(loaded.root);
    this.frameModel(loaded.root);

    // The "before" copy is taken now, so it is the file exactly as it came
    this.beforeModel = this.makeBeforeModel(loaded.root);
    this.scene.add(this.beforeModel);

    this.setupAnimations(loaded.animations);
    return true;
  }

  /** Called (once per file) when a texture of an FBX could not be loaded, e.g. it lives in a separate file. */
  setTextureErrorListener(listener: () => void): void {
    this.textureErrorListener = listener;
  }

  private async loadGlb(url: string): Promise<LoadedModel> {
    const gltf = await this.loader.loadAsync(url);
    return { root: gltf.scene, animations: gltf.animations };
  }

  /** FBX files come with Phong / Lambert materials and usually in centimeters. Both are fixed here. */
  private async loadFbx(url: string): Promise<LoadedModel> {
    if (!this.fbxLoader) {
      // Loaded on demand, so visitors who never open an FBX do not download it
      const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
      const manager = new LoadingManager(undefined, undefined, () => {
        if (this.fbxTexturesFailed) return;
        this.fbxTexturesFailed = true;
        this.textureErrorListener?.();
      });
      this.fbxLoader = new FBXLoader(manager);
    }

    this.fbxTexturesFailed = false;
    const group = await this.fbxLoader.loadAsync(url);
    this.convertMaterials(group);
    this.normalizeUnits(group);
    return { root: group, animations: group.animations ?? [] };
  }

  /**
   * The customizer works on MeshStandardMaterial (the glTF material). FBX gives Phong or Lambert,
   * so each one is replaced by a Standard material with the same color, textures and transparency.
   * A material shared by several meshes stays shared.
   */
  private convertMaterials(root: Object3D): void {
    const converted = new Map<Material, MeshStandardMaterial>();

    const convert = (material: Material): Material => {
      const old = material as any;
      if (!(old.isMeshPhongMaterial || old.isMeshLambertMaterial || old.isMeshBasicMaterial)) return material;

      let standard = converted.get(material);
      if (!standard) {
        standard = new MeshStandardMaterial();
        standard.name = old.name;
        if (old.color) standard.color.copy(old.color);
        if (old.emissive) {
          standard.emissive.copy(old.emissive);
          standard.emissiveIntensity = old.emissiveIntensity ?? 1;
        }
        standard.map = old.map ?? null;
        standard.normalMap = old.normalMap ?? null;
        standard.bumpMap = old.bumpMap ?? null;
        standard.bumpScale = old.bumpScale ?? 1;
        standard.emissiveMap = old.emissiveMap ?? null;
        standard.aoMap = old.aoMap ?? null;
        standard.alphaMap = old.alphaMap ?? null;
        standard.opacity = old.opacity ?? 1;
        standard.transparent = old.transparent ?? false;
        standard.side = old.side;
        standard.vertexColors = old.vertexColors ?? false;
        standard.metalness = 0;
        // Phong's "shininess" is the closest thing to roughness: shinier = smoother
        standard.roughness = old.isMeshPhongMaterial ? 1 - Math.min(1, (old.shininess ?? 30) / 100) : 0.8;
        converted.set(material, standard);
      }
      return standard;
    };

    root.traverse((child) => {
      const mesh = child as Mesh;
      if (!mesh.isMesh) return;
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(convert) : convert(mesh.material);
    });

    // The textures live on in the new materials, only the old shells are freed
    converted.forEach((_, original) => original.dispose());
  }

  /** An FBX that is far larger than a normal model in meters is taken as centimeters. */
  private normalizeUnits(root: Object3D): void {
    const size = new Box3().setFromObject(root).getSize(new Vector3());
    const largest = Math.max(size.x, size.y, size.z);
    if (largest > FBX_CM_THRESHOLD) root.scale.multiplyScalar(FBX_CM_SCALE);
  }

  setLighting(preset: LightingPreset): void {
    this.preset = preset;
    this.applyLighting();
  }

  /** Brightness multiplier on top of the preset (1 = as designed). */
  setLightIntensity(value: number): void {
    this.lightIntensity = Math.min(LIGHT_INTENSITY_RANGE.max, Math.max(LIGHT_INTENSITY_RANGE.min, value));
    this.applyLighting();
  }

  /** Turns the lights around the model, in degrees (0 = as designed). */
  setLightAngle(degrees: number): void {
    const clamped = Math.min(LIGHT_ANGLE_RANGE.max, Math.max(LIGHT_ANGLE_RANGE.min, degrees));
    this.lightAngle = (clamped * Math.PI) / 180;
    this.applyLighting();
  }

  /** A "#rrggbb" color, or null to go back to the page background. */
  setBackground(color: string | null): void {
    this.backgroundColor = color;
    this.scene.background = color ? new Color(color) : null;
  }

  private applyLighting(): void {
    const config = LIGHTING[this.preset];
    const [x, y, z] = config.keyPosition;
    const cos = Math.cos(this.lightAngle);
    const sin = Math.sin(this.lightAngle);

    this.scene.environmentIntensity = config.envIntensity * this.lightIntensity;
    this.scene.environmentRotation.y = config.envRotation + this.lightAngle;
    this.keyLight.intensity = config.keyIntensity * this.lightIntensity;
    this.keyLight.color.setHex(config.keyColor);
    this.keyLight.position.set(x * cos + z * sin, y, -x * sin + z * cos); // turned around the vertical axis
  }

  // ---- Before / after -----------------------------------------------------

  /** Left of the divider shows the original file, right of it the edited model. */
  setCompare(enabled: boolean): void {
    this.compareOn = enabled;
  }

  /** Divider position, 0 (left edge) to 1 (right edge). */
  setComparePosition(fraction: number): void {
    this.comparePos = Math.min(0.98, Math.max(0.02, fraction));
  }

  // ---- Dimensions ---------------------------------------------------------

  setDimensionsVisible(visible: boolean): void {
    this.dimensionsOn = visible;
    this.sizeBox.visible = visible && !this.sizeBox.box.isEmpty();
  }

  /** Measures the visible parts and moves the box around them. Returns null when nothing is visible. */
  updateDimensions(): ModelSize | null {
    const box = this.visibleBox();
    if (!box) {
      this.sizeBox.box.makeEmpty();
      this.sizeBox.visible = false;
      return null;
    }

    this.sizeBox.box.copy(box);
    this.sizeBox.visible = this.dimensionsOn;
    const size = box.getSize(new Vector3());
    return { width: size.x, height: size.y, depth: size.z };
  }

  // ---- Animations ---------------------------------------------------------

  /** The animations of the loaded file (empty for a model that does not move). */
  getAnimations(): AnimationInfo[] {
    return this.clips.map((clip, index) => ({
      index,
      name: this.cleanName(clip.name),
      duration: clip.duration,
    }));
  }

  /** The page gets the state of the animation bar whenever it changes (null when the model has none). */
  setAnimationListener(listener: (state: AnimationState | null) => void): void {
    this.animationListener = listener;
    this.animationKey = '';
  }

  /** Switches to another animation of the file and starts it from the beginning. */
  selectAnimation(index: number, play = true): void {
    const clip = this.clips[index];
    if (!clip || !this.mixer) return;

    this.mixer.stopAllAction();
    this.beforeMixer?.stopAllAction();
    this.action = this.mixer.clipAction(clip);
    this.beforeAction = this.beforeMixer?.clipAction(clip) ?? null;

    for (const action of [this.action, this.beforeAction]) {
      if (!action) continue;
      action.setLoop(this.animLoop ? LoopRepeat : LoopOnce, this.animLoop ? Infinity : 1);
      action.clampWhenFinished = true; // a non-repeating animation stays on its last frame
      action.reset();
      action.play();
      action.paused = !play;
    }

    this.animIndex = index;
    this.animPlaying = play;
    this.mixer.timeScale = this.animSpeed;
    if (this.beforeMixer) this.beforeMixer.timeScale = this.animSpeed;
    this.mixer.update(0);
    this.beforeMixer?.update(0);
    this.animationKey = '';
  }

  setAnimationPlaying(playing: boolean): void {
    const action = this.action;
    const clip = this.clips[this.animIndex];
    if (!action || !clip) return;

    // A finished animation that does not repeat starts again from the beginning
    if (playing && !this.animLoop && action.time >= clip.duration - 1e-3) this.seekAnimation(0);

    this.animPlaying = playing;
    for (const item of [action, this.beforeAction]) {
      if (item) item.paused = !playing;
    }
    this.animationKey = '';
  }

  /** Jumps to a moment of the animation, in seconds. Both copies of the model (before / after) move together. */
  seekAnimation(seconds: number): void {
    const clip = this.clips[this.animIndex];
    if (!clip) return;

    const time = Math.min(clip.duration, Math.max(0, seconds));
    for (const action of [this.action, this.beforeAction]) {
      if (action) action.time = time;
    }
    this.mixer?.update(0);
    this.beforeMixer?.update(0);
    this.animationKey = '';
  }

  /** Playback speed multiplier (1 = normal). */
  setAnimationSpeed(speed: number): void {
    this.animSpeed = Math.min(ANIMATION_SPEED_RANGE.max, Math.max(ANIMATION_SPEED_RANGE.min, speed));
    if (this.mixer) this.mixer.timeScale = this.animSpeed;
    if (this.beforeMixer) this.beforeMixer.timeScale = this.animSpeed;
    this.animationKey = '';
  }

  setAnimationLoop(loop: boolean): void {
    this.animLoop = loop;
    for (const action of [this.action, this.beforeAction]) {
      if (!action) continue;
      action.setLoop(loop ? LoopRepeat : LoopOnce, loop ? Infinity : 1);
      action.clampWhenFinished = true;
    }
    this.animationKey = '';
  }

  private setupAnimations(clips: AnimationClip[]): void {
    this.clips = clips.filter((clip) => clip.tracks.length > 0 && clip.duration > 0);
    this.animationKey = '';
    if (!this.clips.length || !this.model) return;

    this.mixer = new AnimationMixer(this.model);
    if (this.beforeModel) this.beforeMixer = new AnimationMixer(this.beforeModel);
    this.animSpeed = 1;
    this.animLoop = true;
    this.selectAnimation(0, true);
  }

  private advanceAnimation(delta: number): void {
    if (!this.mixer) return;
    const step = Math.min(delta, MAX_ANIMATION_STEP);
    this.mixer.update(step);
    this.beforeMixer?.update(step);
  }

  /** Tells the page about the animation, only when something changed (at most about 20 times a second). */
  private updateAnimationState(): void {
    const listener = this.animationListener;
    if (!listener) return;

    const action = this.action;
    const clip = this.clips[this.animIndex];
    if (!action || !clip) {
      if (this.animationKey !== 'none') {
        this.animationKey = 'none';
        listener(null);
      }
      return;
    }

    // A non-repeating animation pauses itself when it reaches its end
    if (this.animPlaying && action.paused) this.animPlaying = false;

    const time = Math.min(clip.duration, Math.max(0, action.time));
    const key = `${this.animIndex}|${Math.round(time * 20)}|${this.animPlaying}|${this.animSpeed}|${this.animLoop}`;
    if (key === this.animationKey) return;
    this.animationKey = key;

    listener({
      index: this.animIndex,
      time,
      duration: clip.duration,
      playing: this.animPlaying,
      speed: this.animSpeed,
      loop: this.animLoop,
    });
  }

  private disposeAnimations(): void {
    if (this.mixer) {
      this.mixer.stopAllAction();
      if (this.model) this.mixer.uncacheRoot(this.model);
    }
    if (this.beforeMixer) {
      this.beforeMixer.stopAllAction();
      if (this.beforeModel) this.beforeMixer.uncacheRoot(this.beforeModel);
    }
    this.mixer = null;
    this.beforeMixer = null;
    this.action = null;
    this.beforeAction = null;
    this.clips = [];
    this.animIndex = 0;
    this.animPlaying = false;
    this.animationKey = '';
  }

  // ---- Hotspots -----------------------------------------------------------

  /** The page gets the screen position of every hotspot, each time one of them moves. */
  setHotspotListener(listener: (frame: HotspotFrame) => void): void {
    this.hotspotListener = listener;
  }

  /** Replaces the hotspots that follow the model. */
  setHotspots(points: readonly (HotspotPoint & { id: string })[]): void {
    this.hotspotIds = points.map((point) => ({ id: point.id, point: { x: point.x, y: point.y, z: point.z } }));
    this.occlusion.clear();
    this.occlusionAt = 0;
    this.hotspotKey = '';
  }

  /** The spot on the model under a screen point (a tap), in the model's own coordinates. */
  pointOnModel(clientX: number, clientY: number): HotspotPoint | null {
    if (!this.renderer || !this.model) return null;

    const rect = this.renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);

    for (const hit of this.raycaster.intersectObject(this.model, true)) {
      if (!this.isShown(hit.object)) continue; // hidden parts can't be tapped
      const mesh = hit.object as Mesh;
      const material = Array.isArray(mesh.material)
        ? mesh.material[hit.face?.materialIndex ?? 0]
        : mesh.material;
      if (!material || material.opacity < 0.05) continue; // see-through parts let the tap pass

      const local = this.model.worldToLocal(hit.point.clone());
      return { x: local.x, y: local.y, z: local.z };
    }
    return null;
  }

  // ---- Measurements -------------------------------------------------------

  /** The page gets the screen position of every measurement, each time one of them moves. */
  setMeasureListener(listener: (frame: MeasureFrame) => void): void {
    this.measureListener = listener;
  }

  /** Replaces the measurements that follow the model. A measurement with `b` = null is waiting for its second point. */
  setMeasurements(items: readonly { id: string; a: HotspotPoint; b: HotspotPoint | null }[]): void {
    this.measureItems = items.map(({ id, a, b }) => ({
      id,
      a: { x: a.x, y: a.y, z: a.z },
      b: b ? { x: b.x, y: b.y, z: b.z } : null,
    }));
    this.measureOcclusion.clear();
    this.measureOcclusionAt = 0;
    this.measureKey = '';
  }

  // ---- Parts (show / hide) ------------------------------------------------

  getParts(): PartInfo[] {
    return this.parts.map((mesh, index) => ({
      index,
      key: this.partKeys[index],
      name: this.partName(mesh, index),
      visible: mesh.visible,
    }));
  }

  setPartVisible(index: number, visible: boolean): void {
    const mesh = this.parts[index];
    if (mesh) mesh.visible = visible;
  }

  /** Shows every part except the ones listed (by key). Unknown keys are ignored. */
  setHiddenParts(hidden: readonly string[]): void {
    const set = new Set(hidden);
    this.parts.forEach((mesh, index) => (mesh.visible = !set.has(this.partKeys[index])));
  }

  // ---- Turntable, screenshot, video --------------------------------------

  /** Slowly spins the camera around the model. */
  setAutoRotate(enabled: boolean): void {
    if (this.controls) this.controls.autoRotate = enabled;
  }

  /**
   * Renders the current view at a higher resolution and returns it as a PNG.
   * `scale` multiplies the on-screen size (capped so the file never exceeds 4096px).
   * The compare split and the dimension box are left out of the picture.
   */
  async capture(scale: number, transparent: boolean): Promise<Blob> {
    const renderer = this.renderer;
    if (!renderer) throw new Error('SceneManager is not initialised');

    const canvas = renderer.domElement;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const factor = Math.min(scale, MAX_CAPTURE_SIZE / Math.max(width, height));
    const outWidth = Math.round(width * factor);
    const outHeight = Math.round(height * factor);

    const restoreOverlays = this.hideOverlays();
    const previousRatio = renderer.getPixelRatio();
    const previousBackground = this.scene.background;
    if (transparent) this.scene.background = null; // "transparent" wins over a chosen background
    renderer.setPixelRatio(1);
    renderer.setSize(outWidth, outHeight, false);
    this.camera.layers.set(AFTER_LAYER);
    renderer.render(this.scene, this.camera);
    this.scene.background = previousBackground;
    restoreOverlays();

    // Copy the frame right away, before the browser clears the drawing buffer
    const output = document.createElement('canvas');
    output.width = outWidth;
    output.height = outHeight;
    const context = output.getContext('2d');
    if (context) {
      if (!transparent) {
        context.fillStyle =
          getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || BACKGROUND;
        context.fillRect(0, 0, outWidth, outHeight);
      }
      context.drawImage(canvas, 0, 0, outWidth, outHeight);
    }

    // Back to normal size
    renderer.setPixelRatio(previousRatio);
    renderer.setSize(width, height, false);

    return new Promise<Blob>((resolve, reject) => {
      output.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not create image'))), 'image/png');
    });
  }

  /** Records one full turn of the model as a WebM video (without the compare split or dimension box). */
  async recordTurn(durationMs: number): Promise<Blob> {
    const renderer = this.renderer;
    const controls = this.controls;
    if (!renderer || !controls) throw new Error('SceneManager is not initialised');
    if (typeof MediaRecorder === 'undefined') throw new Error('Recording is not supported in this browser.');

    const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((type) =>
      MediaRecorder.isTypeSupported(type),
    );
    if (!mimeType) throw new Error('Recording is not supported in this browser.');

    const stream = renderer.domElement.captureStream(60);
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    const finished = new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    });

    const wasRotating = controls.autoRotate;
    const previousSpeed = controls.autoRotateSpeed;
    const restoreOverlays = this.hideOverlays();
    controls.autoRotateSpeed = 60 / (durationMs / 1000); // one orbit takes 60 / speed seconds
    controls.autoRotate = true;

    try {
      recorder.start();
      await new Promise((resolve) => setTimeout(resolve, durationMs));
      recorder.stop();
      return await finished;
    } finally {
      stream.getTracks().forEach((track) => track.stop());
      controls.autoRotate = wasRotating;
      controls.autoRotateSpeed = previousSpeed;
      restoreOverlays();
    }
  }

  /**
   * Writes the model as it looks now (colors, materials, hidden parts left out) to a .glb.
   * Animations of the file are kept in it. The lights, the background, the hotspots and the
   * measurements are not part of a model file, so they are not saved in it.
   * For an FBX this is also a conversion: the result is a GLB.
   */
  async exportGlb(): Promise<Blob> {
    const model = this.model;
    if (!model) throw new Error('No model to export');

    // Put the model back where the file had it, so it does not come out shifted
    const centered = model.position.clone();
    model.position.copy(this.modelOrigin);
    try {
      const exporter = new GLTFExporter();
      const options = { binary: true, onlyVisible: true };
      let result;
      try {
        result = await exporter.parseAsync(model, this.clips.length ? { ...options, animations: this.clips } : options);
      } catch (error) {
        if (!this.clips.length) throw error;
        // Some animations cannot be written back. The model itself is still worth exporting.
        console.warn('Export with animations failed, exporting without them', error);
        result = await exporter.parseAsync(model, options);
      }
      return new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' });
    } finally {
      model.position.copy(centered);
    }
  }

  // ---- Materials ----------------------------------------------------------

  getMaterials(): MaterialInfo[] {
    return [...this.entries.keys()].map((id) => this.describe(id)!);
  }

  updateMaterial(id: string, changes: MaterialChanges): MaterialInfo | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;

    // Clearcoat needs a physical material. A plain one is upgraded the first time it is used.
    if (changes.clearcoat !== undefined && (changes.clearcoat > 0 || this.isPhysical(entry.material))) {
      this.ensurePhysical(entry).clearcoat = changes.clearcoat;
    }

    const material = entry.material;
    if (changes.color !== undefined) material.color.set(changes.color);
    if (changes.roughness !== undefined) material.roughness = changes.roughness;
    if (changes.metalness !== undefined) material.metalness = changes.metalness;

    if (changes.opacity !== undefined) {
      material.opacity = changes.opacity;
      const transparent = entry.baseTransparent || changes.opacity < 1;
      if (material.transparent !== transparent) {
        material.transparent = transparent;
        material.needsUpdate = true;
      }
    }

    if (changes.glow !== undefined) entry.glow = changes.glow;
    // The glow follows the color, so it is refreshed when either one changes
    if (changes.glow !== undefined || changes.color !== undefined) this.applyGlow(entry);

    return this.describe(id);
  }

  /** Returns the id of the material under a screen point (a click or tap), or null for empty space. */
  pick(clientX: number, clientY: number): string | null {
    if (!this.renderer || !this.model) return null;

    const rect = this.renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);

    for (const hit of this.raycaster.intersectObject(this.model, true)) {
      if (!this.isShown(hit.object)) continue; // hidden parts can't be tapped
      const mesh = hit.object as Mesh;
      const material = Array.isArray(mesh.material)
        ? mesh.material[hit.face?.materialIndex ?? 0]
        : mesh.material;
      if (!material || material.opacity < 0.05) continue; // see-through parts let the click pass

      for (const [id, entry] of this.entries) {
        if (entry.material === material) return id;
      }
    }
    return null;
  }

  resetMaterial(id: string): MaterialInfo | undefined {
    const entry = this.entries.get(id);
    return entry ? this.updateMaterial(id, entry.original) : undefined;
  }

  resetAllMaterials(): MaterialInfo[] {
    for (const [id, entry] of this.entries) this.updateMaterial(id, entry.original);
    return this.getMaterials();
  }

  dispose(): void {
    this.loadId++; // cancels any load still in flight
    cancelAnimationFrame(this.frameId);
    this.resizeObserver?.disconnect();
    this.removeModel();
    this.sizeBox.geometry.dispose();
    (this.sizeBox.material as LineBasicMaterial).dispose();
    this.controls?.dispose();
    this.envTexture?.dispose();
    this.renderer?.dispose();
  }

  // ---- Internals ----------------------------------------------------------

  /** Draws one frame. In compare mode the canvas is split: original on the left, edited on the right. */
  private renderFrame(): void {
    const renderer = this.renderer;
    if (!renderer) return;

    if (!this.compareOn || !this.beforeModel) {
      this.camera.layers.set(AFTER_LAYER);
      renderer.render(this.scene, this.camera);
      return;
    }

    const size = renderer.getSize(this.renderSize);
    const split = Math.round(size.x * this.comparePos);

    renderer.setScissorTest(true);

    renderer.setScissor(0, 0, split, size.y);
    this.camera.layers.set(BEFORE_LAYER);
    renderer.render(this.scene, this.camera);

    renderer.setScissor(split, 0, size.x - split, size.y);
    this.camera.layers.set(AFTER_LAYER);
    renderer.render(this.scene, this.camera);

    renderer.setScissorTest(false);
  }

  /** Works out where every hotspot is on the screen, and tells the page only when something moved. */
  private updateHotspots(): void {
    const renderer = this.renderer;
    const listener = this.hotspotListener;
    const model = this.model;
    if (!renderer || !listener) return;

    if (!model || !this.hotspotIds.length) {
      if (this.hotspotKey !== 'empty') {
        this.hotspotKey = 'empty';
        listener({ width: 0, height: 0, items: [] });
      }
      return;
    }

    const canvas = renderer.domElement;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;

    const now = performance.now();
    const recheck = now - this.occlusionAt > OCCLUSION_INTERVAL_MS;
    if (recheck) this.occlusionAt = now;

    const items: HotspotScreen[] = [];
    this.hotspotIds.forEach(({ id, point }, index) => {
      const world = new Vector3(point.x, point.y, point.z);
      model.localToWorld(world);

      if (recheck || !this.occlusion.has(id)) this.occlusion.set(id, this.isBlocked(world));

      const projected = world.project(this.camera);
      if (projected.z > 1 || projected.z < -1) return; // behind the camera
      if (Math.abs(projected.x) > 1.05 || Math.abs(projected.y) > 1.05) return; // off the screen

      items.push({
        id,
        number: index + 1,
        x: Math.round((projected.x * 0.5 + 0.5) * width),
        y: Math.round((-projected.y * 0.5 + 0.5) * height),
        occluded: this.occlusion.get(id) ?? false,
      });
    });

    const key = `${width}x${height}|${items.map((i) => `${i.id}:${i.x}:${i.y}:${i.occluded}`).join('|')}`;
    if (key === this.hotspotKey) return;
    this.hotspotKey = key;
    listener({ width, height, items });
  }

  /** Works out where every measurement is on the screen, and tells the page only when something moved. */
  private updateMeasurements(): void {
    const renderer = this.renderer;
    const listener = this.measureListener;
    const model = this.model;
    if (!renderer || !listener) return;

    if (!model || !this.measureItems.length) {
      if (this.measureKey !== 'empty') {
        this.measureKey = 'empty';
        listener({ width: 0, height: 0, items: [] });
      }
      return;
    }

    const canvas = renderer.domElement;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;

    const now = performance.now();
    const recheck = now - this.measureOcclusionAt > OCCLUSION_INTERVAL_MS;
    if (recheck) this.measureOcclusionAt = now;

    const items: MeasureScreenItem[] = [];
    for (const { id, a, b } of this.measureItems) {
      const worldA = model.localToWorld(new Vector3(a.x, a.y, a.z));
      const worldB = b ? model.localToWorld(new Vector3(b.x, b.y, b.z)) : null;
      const meters = worldB ? worldA.distanceTo(worldB) : 0;

      const screenA = this.measureScreen(worldA, `${id}:a`, recheck, width, height);
      const screenB = worldB ? this.measureScreen(worldB, `${id}:b`, recheck, width, height) : null;
      if (!screenA || (worldB && !screenB)) continue; // an end is behind the camera

      items.push({ id, a: screenA, b: screenB, meters });
    }

    const key = `${width}x${height}|${items
      .map(
        (i) =>
          `${i.id}:${i.a.x}:${i.a.y}:${i.a.occluded}:${i.b?.x}:${i.b?.y}:${i.b?.occluded}:${i.meters.toFixed(5)}`,
      )
      .join('|')}`;
    if (key === this.measureKey) return;
    this.measureKey = key;
    listener({ width, height, items });
  }

  private measureScreen(
    world: Vector3,
    key: string,
    recheck: boolean,
    width: number,
    height: number,
  ): MeasureScreenPoint | null {
    if (recheck || !this.measureOcclusion.has(key)) this.measureOcclusion.set(key, this.isBlocked(world));

    const projected = world.clone().project(this.camera);
    if (projected.z > 1 || projected.z < -1) return null;

    return {
      x: Math.round((projected.x * 0.5 + 0.5) * width),
      y: Math.round((-projected.y * 0.5 + 0.5) * height),
      occluded: this.measureOcclusion.get(key) ?? false,
    };
  }

  /** True when a solid part of the model is between the camera and this point. */
  private isBlocked(target: Vector3): boolean {
    const model = this.model;
    if (!model) return false;

    const origin = this.camera.position;
    const direction = this.rayDirection.copy(target).sub(origin);
    const distance = direction.length();
    if (!distance) return false;
    direction.divideScalar(distance);

    this.raycaster.set(origin, direction);
    const tolerance = distance * 0.02 + 1e-4; // the point itself sits on the surface

    for (const hit of this.raycaster.intersectObject(model, true)) {
      if (hit.distance >= distance - tolerance) break;
      if (!this.isShown(hit.object)) continue;
      const mesh = hit.object as Mesh;
      const material = Array.isArray(mesh.material)
        ? mesh.material[hit.face?.materialIndex ?? 0]
        : mesh.material;
      if (!material || material.opacity < 0.05) continue;
      return true;
    }
    return false;
  }

  /** Hides the split and the dimension box (for screenshots and video). Returns a function that brings them back. */
  private hideOverlays(): () => void {
    const compare = this.compareOn;
    const box = this.sizeBox.visible;
    this.compareOn = false;
    this.sizeBox.visible = false;
    return () => {
      this.compareOn = compare;
      this.sizeBox.visible = box;
    };
  }

  /** A copy of the model with its own materials, so later edits never touch it. */
  private makeBeforeModel(source: Object3D): Object3D {
    const copy = cloneObject(source);
    copy.traverse((child) => {
      child.layers.set(BEFORE_LAYER);
      const mesh = child as Mesh;
      if (!mesh.isMesh) return;
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map((material) => material.clone())
        : mesh.material.clone();
    });
    return copy;
  }

  /** Frees the "before" copy. Geometry and textures are shared with the real model, which frees them. */
  private disposeBeforeModel(): void {
    if (!this.beforeModel) return;
    this.scene.remove(this.beforeModel);
    this.beforeModel.traverse((child) => {
      const mesh = child as Mesh;
      if (!mesh.isMesh) return;
      const materials: Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((material) => material.dispose());
    });
    this.beforeModel = null;
  }

  /** Bounding box of the parts that are visible right now, or null when everything is hidden. */
  private visibleBox(): Box3 | null {
    if (!this.model) return null;
    this.model.updateWorldMatrix(true, true);

    const box = new Box3();
    const part = new Box3();
    for (const mesh of this.parts) {
      if (!this.isShown(mesh)) continue;
      part.setFromObject(mesh);
      box.union(part);
    }
    return box.isEmpty() ? null : box;
  }

  /** Finds every PBR material actually used by the model (shared ones only once). */
  private collectMaterials(root: Object3D): void {
    this.entries.clear();
    let index = 0;

    root.traverse((child) => {
      const mesh = child as Mesh;
      if (!mesh.isMesh) return;

      const list: Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of list) {
        const standard = material as MeshStandardMaterial;
        if (!standard.isMeshStandardMaterial || this.entries.has(standard.uuid)) continue;

        index++;
        const entry: MaterialEntry = {
          material: standard,
          name: this.displayName(standard.name, index),
          glow: 0,
          baseEmissive: standard.emissive.clone(),
          baseEmissiveIntensity: standard.emissiveIntensity,
          baseEmissiveMap: standard.emissiveMap,
          baseTransparent: standard.transparent,
          original: { color: '#ffffff', roughness: 0, metalness: 0, opacity: 1, glow: 0, clearcoat: 0 },
        };
        entry.original = this.snapshot(entry);
        this.entries.set(standard.uuid, entry);
      }
    });
  }

  /** True while at least one visible mesh still uses this material. */
  isMaterialVisible(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    return this.parts.some((mesh) => {
      if (!this.isShown(mesh)) return false;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      return list.includes(entry.material);
    });
  }

  /** Every mesh, with a stable key (name + repeat count) so show / hide can be saved by name. */
  private collectParts(root: Object3D): void {
    this.parts = [];
    this.partKeys = [];
    const seen = new Map<string, number>();
    root.traverse((child) => {
      const mesh = child as Mesh;
      if (!mesh.isMesh) return;
      const raw = this.rawPartName(mesh, root);
      const count = (seen.get(raw) ?? 0) + 1;
      seen.set(raw, count);
      this.parts.push(mesh);
      this.partKeys.push(`${raw}#${count}`);
    });
  }

  /** Unnamed meshes borrow the name of their closest named parent. */
  private rawPartName(mesh: Mesh, root: Object3D): string {
    let node: Object3D | null = mesh;
    while (node && !node.name) node = node.parent;
    return node && node !== root ? node.name : '';
  }

  private partName(mesh: Mesh, index: number): string {
    const raw = this.rawPartName(mesh, this.model as Object3D);
    if (!raw) return `Part ${index + 1}`;
    return this.cleanName(raw);
  }

  private cleanName(raw: string): string {
    const clean = raw.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    return clean.charAt(0).toUpperCase() + clean.slice(1);
  }

  private isShown(object: Object3D): boolean {
    for (let node: Object3D | null = object; node; node = node.parent) {
      if (!node.visible) return false;
    }
    return true;
  }

  private describe(id: string): MaterialInfo | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    return { id, name: entry.name, ...this.snapshot(entry) };
  }

  private snapshot(entry: MaterialEntry): Required<MaterialChanges> {
    const material = entry.material;
    return {
      color: `#${material.color.getHexString()}`,
      roughness: material.roughness,
      metalness: material.metalness,
      opacity: material.opacity,
      glow: entry.glow,
      clearcoat: this.isPhysical(material) ? material.clearcoat : 0,
    };
  }

  private isPhysical(material: MeshStandardMaterial): material is MeshPhysicalMaterial {
    return (material as MeshPhysicalMaterial).isMeshPhysicalMaterial === true;
  }

  /** Lets the surface light itself in its own color (textures included). Glow 0 restores the original. */
  private applyGlow(entry: MaterialEntry): void {
    const material = entry.material;
    const previousMap = material.emissiveMap;

    if (entry.glow <= 0) {
      material.emissive.copy(entry.baseEmissive);
      material.emissiveIntensity = entry.baseEmissiveIntensity;
      material.emissiveMap = entry.baseEmissiveMap;
    } else {
      material.emissive.copy(material.color);
      material.emissiveIntensity = entry.glow * 2;
      material.emissiveMap = material.map ?? entry.baseEmissiveMap;
    }

    if (previousMap !== material.emissiveMap) material.needsUpdate = true;
  }

  /** Swaps a plain material for a physical one (same look) on every mesh that uses it. */
  private ensurePhysical(entry: MaterialEntry): MeshPhysicalMaterial {
    const current = entry.material;
    if (this.isPhysical(current)) return current;

    const upgraded = new MeshPhysicalMaterial();
    MeshStandardMaterial.prototype.copy.call(upgraded, current);
    upgraded.defines = { STANDARD: '', PHYSICAL: '' }; // copy() resets this
    upgraded.needsUpdate = true;

    this.model?.traverse((child) => {
      const mesh = child as Mesh;
      if (!mesh.isMesh) return;
      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map((item) => (item === current ? upgraded : item));
      } else if (mesh.material === current) {
        mesh.material = upgraded;
      }
    });

    current.dispose();
    entry.material = upgraded;
    return upgraded;
  }

  private displayName(rawName: string, index: number): string {
    const clean = rawName.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!clean) return `Material ${index}`;
    return clean.charAt(0).toUpperCase() + clean.slice(1);
  }

  /** Centers the model at the origin and places the camera so it fits the screen. */
  private frameModel(model: Object3D): void {
    const box = new Box3().setFromObject(model);
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());
    this.modelOrigin.copy(model.position);
    model.position.sub(center);

    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const fov = (this.camera.fov * Math.PI) / 180;
    // On portrait screens (phones) the horizontal view is narrower, so fit the width
    const fitFactor = Math.min(1, this.camera.aspect);
    const distance = (maxDim / 2 / (Math.tan(fov / 2) * fitFactor)) * 1.8;

    this.camera.near = distance / 100;
    this.camera.far = distance * 100;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(1, 0.6, 1).normalize().multiplyScalar(distance);

    if (this.controls) {
      this.controls.target.set(0, 0, 0);
      this.controls.minDistance = distance * 0.3;
      this.controls.maxDistance = distance * 4;
      this.controls.update();
    }
  }

  private removeModel(): void {
    this.disposeAnimations();
    this.disposeBeforeModel();
    this.sizeBox.box.makeEmpty();
    this.sizeBox.visible = false;
    this.hotspotIds = []; // hotspots belong to the model that is going away
    this.occlusion.clear();
    this.measureItems = []; // so do the measurements
    this.measureOcclusion.clear();
    this.measureKey = '';
    this.entries.clear();
    this.parts = [];
    this.partKeys = [];
    if (!this.model) return;
    this.scene.remove(this.model);
    this.disposeObject(this.model);
    this.model = null;
  }

  /** Frees GPU memory: geometries, materials and their textures. */
  private disposeObject(root: Object3D): void {
    root.traverse((child) => {
      const mesh = child as Mesh;
      if (!mesh.isMesh) return;

      mesh.geometry.dispose();
      const materials: Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        for (const value of Object.values(material)) {
          if (value instanceof Texture) value.dispose();
        }
        material.dispose();
      }
    });
  }
}