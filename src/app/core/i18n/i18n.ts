import { Injectable, effect, signal } from '@angular/core';

export type Lang = 'en' | 'ar';

const STORAGE_KEY = 'modexa3d-lang';

const EN = {
  // Top bar
  'topbar.export': 'Export',
  'topbar.exportTitle': 'Export the model as a .glb file',
  'topbar.upload': 'Upload',
  'theme.toLight': 'Switch to light mode',
  'theme.toDark': 'Switch to dark mode',
  'theme.light': 'Light mode',
  'theme.dark': 'Dark mode',
  'lang.short': 'ع',
  'lang.switch': 'Switch to Arabic',

  // Viewer
  'viewer.undo': 'Undo',
  'viewer.undoTitle': 'Undo (Ctrl+Z)',
  'viewer.redo': 'Redo',
  'viewer.redoTitle': 'Redo (Ctrl+Shift+Z)',
  'viewer.turntable': 'Turntable',
  'viewer.record': 'Record turntable video',
  'viewer.recordTitle': 'Record a 6 second video',
  'viewer.screenshot': 'Screenshot',
  'viewer.compare': 'Compare before and after',
  'viewer.dimensions': 'Show dimensions',
  'viewer.hotspot': 'Add a point with a note',
  'viewer.measure': 'Measure a distance',
  'viewer.uploadModel': 'Upload model',
  'viewer.hint': 'Drag to rotate · Scroll or pinch to zoom · Tap a part to edit it',
  'viewer.canvas': 'Interactive 3D model viewer',
  'viewer.loading': 'Loading model',
  'cursor.edit': 'Edit',
  'cursor.addPoint': 'Add',
  'cursor.measure': 'Measure',

  // Before / after
  'compare.before': 'Before',
  'compare.after': 'After',
  'compare.handle': 'Drag to compare before and after',

  // Dimensions
  'dim.title': 'Size of the visible parts',
  'dim.width': 'Width',
  'dim.height': 'Height',
  'dim.depth': 'Depth',
  'dim.unit': 'Unit',
  'unit.m': 'm',
  'unit.cm': 'cm',
  'unit.mm': 'mm',
  'unit.in': 'in',

  // Hotspots
  'hotspot.hint': 'Tap the model where you want a note · Esc to cancel',
  'hotspot.pin': 'Point {n}',
  'hotspot.note': 'Note',
  'hotspot.placeholder': 'Write a note…',
  'hotspot.delete': 'Delete',
  'hotspot.deleteAria': 'Delete point {n}',

  // Measuring
  'measure.hint': 'Tap two points on the model to measure the distance · Esc to cancel',
  'measure.second': 'Now tap the second point',
  'measure.title': 'Measurements',
  'measure.clear': 'Clear all',

  // Animation bar
  'anim.bar': 'Animation controls',
  'anim.play': 'Play',
  'anim.pause': 'Pause',
  'anim.clip': 'Animation',
  'anim.time': 'Animation position',
  'anim.speed': 'Speed',
  'anim.loop': 'Repeat',
  'anim.unnamed': 'Animation {n}',

  // Screenshot menu
  'shot.options': 'Screenshot options',
  'shot.quality': 'Quality',
  'shot.standard': 'Standard',
  'shot.hd': 'HD',
  'shot.ultra': 'Ultra',
  'shot.transparent': 'Transparent background',
  'shot.save': 'Save PNG',

  // Drop zone ("Drag a" + GLB + the text below = "Drag a GLB or FBX file here, …")
  'drop.title': 'Explore any 3D model',
  'drop.before': 'Drag a',
  'drop.after': 'or FBX file here, or pick a sample to start.',
  'drop.upload': 'Upload model',
  'drop.sample': 'or try a sample',
  'drop.overlay': 'Drop your .glb or .fbx file to load it',

  // Customizer
  'cz.customize': 'Customize',
  'cz.materials': 'Materials',
  'cz.resetAll': 'Reset all',
  'cz.reset': 'Reset',
  'cz.noModel': 'Load a model and every material will appear here.',
  'cz.noMaterials': 'This model has no editable materials.',
  'cz.colorOf': 'Color of {name}',
  'cz.setTo': 'Set {name} to {color}',
  'cz.customColor': 'Pick any color for {name}',
  'cz.hex': 'Color code',
  'cz.pickScreen': 'Pick a color from the screen',
  'cz.recent': 'Recent',
  'cz.more': 'More',
  'cz.opacity': 'Opacity',
  'cz.glow': 'Glow',
  'cz.clearcoat': 'Clearcoat',
  'cz.roughness': 'Roughness',
  'cz.metalness': 'Metalness',
  'cz.lighting': 'Lighting',
  'light.studio': 'Studio',
  'light.front': 'Front',
  'light.around': 'All around',
  'light.sunset': 'Sunset',
  'cz.lightIntensity': 'Brightness',
  'cz.lightAngle': 'Direction',

  // Parts and scene
  'cz.parts': 'Parts',
  'cz.showAll': 'Show all',
  'cz.hiddenCount': '{n} hidden',
  'cz.showPart': 'Show {name}',
  'cz.hidePart': 'Hide {name}',
  'cz.scene': 'Background',
  'cz.bgDefault': 'Default',
  'cz.bgCustom': 'Pick a background color',
  'cz.bgColor': 'Background color',
  'cz.resetScene': 'Reset scene',

  // Saved designs
  'cz.designs': 'Designs',
  'cz.designName': 'Name this design',
  'cz.saveDesign': 'Save',
  'cz.noDesigns': 'Saved designs will appear here.',
  'cz.loadDesign': 'Load design {name}',
  'cz.deleteDesign': 'Delete design {name}',
  'cz.defaultName': 'Design {n}',

  // Categories of the sample models
  'cat.Furniture': 'Furniture',
  'cat.Accessories': 'Accessories',
  'cat.Vehicles': 'Vehicles',

  // Sign-in
  'auth.title': 'Sign in to continue',
  'auth.subtitle': 'This site is private. Sign in with the Google account that was invited.',
  'auth.google': 'Continue with Google',
  'auth.checking': 'Checking your access…',
  'auth.deniedTitle': 'No access',
  'auth.denied': '{email} is not on the list of allowed accounts. Ask the owner to add it, or try another account.',
  'auth.switch': 'Use another account',
  'auth.setupTitle': 'Almost there',
  'auth.notConfigured': 'Firebase is not set up yet. Paste your project settings into firebase-config.ts.',
  'auth.errorTitle': 'Connection problem',
  'auth.error': "Couldn't reach the sign-in service. Check your connection and try again.",
  'auth.retry': 'Try again',
  'auth.signInFail': "Couldn't sign in. Please try again.",
  'auth.signOut': 'Sign out',

  // Messages
  'msg.saveFail': "Couldn't save the design on this device. Storage may be full or blocked.",
  'msg.designMissing': "This design's file is no longer stored on this device.",
  'msg.designSaved': 'Design saved',
  'msg.designLoaded': 'Design loaded',
  'msg.exported': 'Model exported as .glb',
  'msg.exportFail': "Couldn't export the model.",
  'msg.hotspotLimit': 'You reached the limit of {n} points.',
  'msg.measureLimit': 'You reached the limit of {n} measurements.',
  'msg.shotSaved': 'Screenshot saved',
  'msg.shotFail': "Couldn't save the screenshot.",
  'msg.recording': 'Recording one full turn…',
  'msg.videoSaved': 'Video saved',
  'msg.recordFail': "Couldn't record the video. Your browser may not support recording.",
  'msg.onlyGlb': 'Only .glb and .fbx files are supported for now.',
  'msg.tooLarge': 'This file is larger than {n} MB. Try a smaller model.',
  'msg.invalidGlb': "This doesn't look like a valid .glb or .fbx file.",
  'msg.loadFail': "Couldn't load this model. Make sure it's a valid .glb or .fbx file.",
  'msg.fbxTextures':
    "Some textures of this FBX file couldn't be loaded because they are stored in separate files. Use an FBX with embedded textures, or a GLB.",
} as const;

export type TextKey = keyof typeof EN;

// Typed as Record<TextKey, string>, so the compiler tells you if a translation is missing
const AR: Record<TextKey, string> = {
  'topbar.export': 'تصدير',
  'topbar.exportTitle': 'تصدير المجسم كملف GLB',
  'topbar.upload': 'رفع',
  'theme.toLight': 'التبديل إلى الوضع الفاتح',
  'theme.toDark': 'التبديل إلى الوضع الداكن',
  'theme.light': 'الوضع الفاتح',
  'theme.dark': 'الوضع الداكن',
  'lang.short': 'EN',
  'lang.switch': 'التبديل إلى الإنجليزية',

  'viewer.undo': 'تراجع',
  'viewer.undoTitle': 'تراجع (Ctrl+Z)',
  'viewer.redo': 'إعادة',
  'viewer.redoTitle': 'إعادة (Ctrl+Shift+Z)',
  'viewer.turntable': 'دوران تلقائي',
  'viewer.record': 'تسجيل فيديو دوران',
  'viewer.recordTitle': 'تسجيل فيديو لمدة 6 ثوانٍ',
  'viewer.screenshot': 'لقطة شاشة',
  'viewer.compare': 'مقارنة قبل وبعد',
  'viewer.dimensions': 'عرض الأبعاد',
  'viewer.hotspot': 'إضافة نقطة بملاحظة',
  'viewer.measure': 'قياس مسافة',
  'viewer.uploadModel': 'رفع مجسم',
  'viewer.hint': 'اسحب للتدوير · مرّر أو اقرص للتكبير · المس جزءًا لتعديله',
  'viewer.canvas': 'عارض المجسمات ثلاثية الأبعاد',
  'viewer.loading': 'جارٍ تحميل المجسم',
  'cursor.edit': 'تعديل',
  'cursor.addPoint': 'إضافة',
  'cursor.measure': 'قياس',

  'compare.before': 'قبل',
  'compare.after': 'بعد',
  'compare.handle': 'اسحب للمقارنة بين قبل وبعد',

  'dim.title': 'مقاسات الأجزاء الظاهرة',
  'dim.width': 'العرض',
  'dim.height': 'الارتفاع',
  'dim.depth': 'العمق',
  'dim.unit': 'الوحدة',
  'unit.m': 'م',
  'unit.cm': 'سم',
  'unit.mm': 'مم',
  'unit.in': 'بوصة',

  'hotspot.hint': 'المس المجسم في المكان الذي تريد إضافة ملاحظة عليه · Esc للإلغاء',
  'hotspot.pin': 'النقطة {n}',
  'hotspot.note': 'الملاحظة',
  'hotspot.placeholder': 'اكتب ملاحظة…',
  'hotspot.delete': 'حذف',
  'hotspot.deleteAria': 'حذف النقطة {n}',

  'measure.hint': 'المس نقطتين على المجسم لقياس المسافة بينهما · Esc للإلغاء',
  'measure.second': 'والآن المس النقطة الثانية',
  'measure.title': 'القياسات',
  'measure.clear': 'مسح الكل',

  'anim.bar': 'التحكم في الحركة',
  'anim.play': 'تشغيل',
  'anim.pause': 'إيقاف مؤقت',
  'anim.clip': 'الحركة',
  'anim.time': 'موضع الحركة',
  'anim.speed': 'السرعة',
  'anim.loop': 'تكرار',
  'anim.unnamed': 'حركة {n}',

  'shot.options': 'خيارات لقطة الشاشة',
  'shot.quality': 'الجودة',
  'shot.standard': 'عادية',
  'shot.hd': 'HD',
  'shot.ultra': 'فائقة',
  'shot.transparent': 'خلفية شفافة',
  'shot.save': 'حفظ PNG',

  'drop.title': 'استكشف أي مجسم ثلاثي الأبعاد',
  'drop.before': 'اسحب ملف',
  'drop.after': 'أو FBX هنا، أو اختر مجسمًا جاهزًا للبدء.',
  'drop.upload': 'رفع مجسم',
  'drop.sample': 'أو جرّب مجسمًا جاهزًا',
  'drop.overlay': 'أفلت ملف GLB أو FBX لتحميله',

  'cz.customize': 'التخصيص',
  'cz.materials': 'الخامات',
  'cz.resetAll': 'إعادة الكل',
  'cz.reset': 'إعادة',
  'cz.noModel': 'حمّل مجسمًا وستظهر كل خاماته هنا.',
  'cz.noMaterials': 'هذا المجسم لا يحتوي على خامات قابلة للتعديل.',
  'cz.colorOf': 'لون {name}',
  'cz.setTo': 'اضبط {name} على {color}',
  'cz.customColor': 'اختر أي لون لـ {name}',
  'cz.hex': 'كود اللون',
  'cz.pickScreen': 'التقط لونًا من الشاشة',
  'cz.recent': 'الأخيرة',
  'cz.more': 'المزيد',
  'cz.opacity': 'الشفافية',
  'cz.glow': 'التوهج',
  'cz.clearcoat': 'اللمعة',
  'cz.roughness': 'الخشونة',
  'cz.metalness': 'المعدنية',
  'cz.lighting': 'الإضاءة',
  'light.studio': 'ستوديو',
  'light.front': 'أمامية',
  'light.around': 'من كل الاتجاهات',
  'light.sunset': 'غروب',
  'cz.lightIntensity': 'السطوع',
  'cz.lightAngle': 'الاتجاه',

  'cz.parts': 'الأجزاء',
  'cz.showAll': 'إظهار الكل',
  'cz.hiddenCount': '{n} مخفي',
  'cz.showPart': 'إظهار {name}',
  'cz.hidePart': 'إخفاء {name}',
  'cz.scene': 'الخلفية',
  'cz.bgDefault': 'الافتراضية',
  'cz.bgCustom': 'اختر لون الخلفية',
  'cz.bgColor': 'لون الخلفية',
  'cz.resetScene': 'إعادة المشهد',

  'cz.designs': 'التصاميم',
  'cz.designName': 'اسم التصميم',
  'cz.saveDesign': 'حفظ',
  'cz.noDesigns': 'ستظهر تصاميمك المحفوظة هنا.',
  'cz.loadDesign': 'تحميل التصميم {name}',
  'cz.deleteDesign': 'حذف التصميم {name}',
  'cz.defaultName': 'تصميم {n}',

  'cat.Furniture': 'أثاث',
  'cat.Accessories': 'إكسسوارات',
  'cat.Vehicles': 'مركبات',

  'auth.title': 'سجّل الدخول للمتابعة',
  'auth.subtitle': 'هذا الموقع خاص. سجّل الدخول بحساب جوجل الذي تمت دعوته.',
  'auth.google': 'المتابعة بحساب جوجل',
  'auth.checking': 'جارٍ التحقق من صلاحيتك…',
  'auth.deniedTitle': 'لا توجد صلاحية',
  'auth.denied': 'الحساب {email} ليس ضمن الحسابات المسموح لها. اطلب من صاحب الموقع إضافته، أو جرّب حسابًا آخر.',
  'auth.switch': 'استخدم حسابًا آخر',
  'auth.setupTitle': 'على وشك الانتهاء',
  'auth.notConfigured': 'لم يتم إعداد Firebase بعد. ضع إعدادات مشروعك في ملف firebase-config.ts.',
  'auth.errorTitle': 'مشكلة في الاتصال',
  'auth.error': 'تعذّر الوصول إلى خدمة تسجيل الدخول. تحقق من الاتصال وحاول مرة أخرى.',
  'auth.retry': 'حاول مرة أخرى',
  'auth.signInFail': 'تعذّر تسجيل الدخول. حاول مرة أخرى.',
  'auth.signOut': 'تسجيل الخروج',

  'msg.saveFail': 'تعذّر حفظ التصميم على هذا الجهاز. قد تكون المساحة ممتلئة أو التخزين محظورًا.',
  'msg.designMissing': 'ملف هذا التصميم لم يعد محفوظًا على هذا الجهاز.',
  'msg.designSaved': 'تم حفظ التصميم',
  'msg.designLoaded': 'تم تحميل التصميم',
  'msg.exported': 'تم تصدير المجسم كملف GLB',
  'msg.exportFail': 'تعذّر تصدير المجسم.',
  'msg.hotspotLimit': 'وصلت إلى الحد الأقصى وهو {n} نقطة.',
  'msg.measureLimit': 'وصلت إلى الحد الأقصى وهو {n} قياسات.',
  'msg.shotSaved': 'تم حفظ اللقطة',
  'msg.shotFail': 'تعذّر حفظ اللقطة.',
  'msg.recording': 'جارٍ تسجيل دورة كاملة…',
  'msg.videoSaved': 'تم حفظ الفيديو',
  'msg.recordFail': 'تعذّر تسجيل الفيديو. قد لا يدعم متصفحك التسجيل.',
  'msg.onlyGlb': 'الملفات المدعومة حاليًا هي GLB وFBX فقط.',
  'msg.tooLarge': 'حجم الملف أكبر من {n} ميجابايت. جرّب مجسمًا أصغر.',
  'msg.invalidGlb': 'هذا الملف لا يبدو ملف GLB أو FBX صالحًا.',
  'msg.loadFail': 'تعذّر تحميل هذا المجسم. تأكد أنه ملف GLB أو FBX صالح.',
  'msg.fbxTextures':
    'تعذّر تحميل بعض خامات ملف FBX لأنها محفوظة في ملفات منفصلة. استخدم ملف FBX بتكستشر مضمّن، أو ملف GLB.',
};

const DICTIONARIES: Record<Lang, Record<string, string>> = { en: EN, ar: AR };

@Injectable({ providedIn: 'root' })
export class I18n {
  readonly lang = signal<Lang>(this.initialLang());

  constructor() {
    this.apply(this.lang());

    effect(() => {
      const lang = this.lang();
      this.apply(lang);
      try {
        localStorage.setItem(STORAGE_KEY, lang);
      } catch {
        // storage can be blocked, the language still works
      }
    });
  }

  /** Translates a key. Reading this inside a template makes it update when the language changes. */
  t(key: TextKey, params?: Record<string, string | number>): string {
    return this.format(DICTIONARIES[this.lang()][key] ?? EN[key], params);
  }

  /** For keys built at runtime (like model categories). Returns the fallback if there's no translation. */
  tryT(key: string, fallback: string): string {
    return DICTIONARIES[this.lang()][key] ?? fallback;
  }

  toggle(): void {
    this.lang.update((lang) => (lang === 'en' ? 'ar' : 'en'));
  }

  private format(text: string, params?: Record<string, string | number>): string {
    if (!params) return text;
    return text.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ''));
  }

  private apply(lang: Lang): void {
    const root = document.documentElement;
    root.lang = lang;
    root.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }

  private initialLang(): Lang {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'en' || saved === 'ar') return saved;
    } catch {
      // ignore
    }
    return navigator.language?.toLowerCase().startsWith('ar') ? 'ar' : 'en';
  }
}