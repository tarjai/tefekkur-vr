// Tüm sihirli sayılar burada: süreler, mesafeler, oranlar, renkler.
// Diğer modüller sabit değer yazmaz, buradan okur.

// ---------- Dil ----------
export const LOCALE = 'tr';

// ---------- Seans ----------
export const SESSION_DURATIONS_MIN = [30, 45, 60] as const;
export const DEFAULT_DURATION_MIN = 45;

export const PHASE_ORDER = ['arrival', 'seed', 'deepening', 'plateau', 'return'] as const;

/** Faz oranları; toplamı 1 olmalı. */
export const PHASE_RATIOS = {
  arrival: 0.08,
  seed: 0.1,
  deepening: 0.6,
  plateau: 0.14,
  return: 0.08,
} as const;

/** Okuma mesafesinde bekleme (görünme) süreleri, saniye. `closing` seans sonu sorusu içindir. */
export const HOLD_SECONDS = {
  anchor: 75,
  question: 40,
  koan: 40,
  quote: 40,
  sensory: 18,
  closing: 40,
} as const;

/** Nefes döngüsü: 5 sn al / 5 sn ver. */
export const BREATH_PERIOD_S = 10;
export const APPROACH_S = 2 * BREATH_PERIOD_S; // 2 nefes döngüsü
export const RETREAT_S = 1 * BREATH_PERIOD_S; // 1 nefes döngüsü

/** Prompt'lar arası sessizlik = önceki prompt'un bekleme süresi × [MIN, MAX] (seed'li RNG). */
export const SILENCE_FACTOR_MIN = 1.2;
export const SILENCE_FACTOR_MAX = 1.8;

/** deepening fazında prompt'ların sahnede olduğu toplam süre (yaklaşma + bekleme + geri çekilme) fazın bu oranını aşamaz. */
export const DEEPENING_VISIBLE_MAX_RATIO = 0.4;

/** deepening'de her N prompt'tan sonra anchor tekrar gelir. */
export const ANCHOR_REPEAT_EVERY = 5;

/** seed / return fazlarında prompt'ların çevresinde bırakılan en kısa sessizlik, saniye. */
export const MIN_EDGE_SILENCE_S = 4;

/** Prompt'ların görünmeye başlama anı nefes döngüsünün başına hizalanır (sığdığı sürece). */
export const ALIGN_TO_BREATH = true;

/** Tek karede saatin ilerleyebileceği en uzun gerçek süre (gözlük çıkarılınca sıçramayı önler), ms. */
export const MAX_FRAME_DELTA_MS = 250;

/** `?speed=N` URL parametresi; geliştirmede seansı hızlandırır. */
export const SPEED_PARAM = 'speed';
export const SPEED_MIN = 0.1;
export const SPEED_MAX = 600;

/** `?emu` URL parametresi: headset olmadan Meta Quest 3 emülatörü (IWER). */
export const EMULATOR_PARAM = 'emu';

// ---------- Deste ----------
export const PROMPT_MAX_CHARS = 60;
export const PROMPT_MAX_LINES = 2;
export const DECK_MIN_PROMPTS = 40;
export const DECK_MAX_PROMPTS = 80;

/** Deste başına tip dağılımı hedefi (oran). anchor: 1 adet, tekrar eden. */
export const DECK_TYPE_TARGETS = {
  question: 0.35,
  koan: 0.2,
  quote: 0.15,
  sensory: 0.2,
} as const;

/** Deste üretiminde varsayılan model (`ANTHROPIC_MODEL` ile ezilir). */
export const DEFAULT_DECK_MODEL = 'claude-sonnet-5-5';

// ---------- Sahne ----------
/** Saf siyah yok: Quest 3 LCD'de gri görünür. */
export const COLORS = {
  skyTop: '#0a0f2e',
  skyHorizon: '#1c1846',
  skyBottom: '#2b1650',
  fog: '#1a1640',
  ring: '#a9b8ff',
  text: '#eef0ff',
  particles: '#c8c2ff',
  pauseDim: '#060818',
  pauseText: '#dfe3ff',
  background2d: '#0d1130',
} as const;

/** Üstel sis yoğunluğu (THREE.FogExp2). */
export const FOG_DENSITY = 0.045;

/** Gökyüzü küresi yarıçapı, m. */
export const SKY_RADIUS_M = 80;

/** plateau'da ortamın koyulaşma miktarı (0..1) ve return'de aydınlanma miktarı (0..1). */
export const PLATEAU_DARKEN = 0.3;
export const RETURN_BRIGHTEN = 0.35;
/** Ortam ışığı değişimlerinin geçiş süresi (seans zamanı), saniye. */
export const MOOD_TRANSITION_S = 30;

/** Yerdeki ışık halkası: kullanıcının önünde, zeminde. */
export const RING_DISTANCE_M = 1.0;
export const RING_INNER_RADIUS_M = 0.32;
export const RING_OUTER_RADIUS_M = 0.335;
export const RING_SEGMENTS = 96;
export const RING_OPACITY_MIN = 0.18;
export const RING_OPACITY_MAX = 0.6;

/** Süzülen partiküller (≤ 500). */
export const PARTICLE_COUNT = 360;
export const PARTICLE_AREA_RADIUS_M = 14;
export const PARTICLE_AREA_HEIGHT_M = 8;
export const PARTICLE_SIZE_PX = 2.2;
export const PARTICLE_OPACITY = 0.55;
/** Partikül hızı, m/sn; nefesle BASE..BASE+BREATH arasında değişir. */
export const PARTICLE_SPEED_BASE = 0.04;
export const PARTICLE_SPEED_BREATH = 0.05;

/** Konum: `local-floor` alınamazsa varsayılan göz yüksekliği (oturur), m. */
export const FALLBACK_EYE_HEIGHT_M = 1.2;
/** XR dışı 2D arka plan önizlemesinde kamera yüksekliği, m. */
export const PREVIEW_EYE_HEIGHT_M = 1.2;
export const CAMERA_FOV_DEG = 70;
export const CAMERA_NEAR_M = 0.05;
export const CAMERA_FAR_M = 200;

// ---------- Prompt ----------
export const PROMPT_START_DISTANCE_M = 12;
export const PROMPT_READ_DISTANCE_M = 2;
/** Prompt'un göz hizasının altındaki açısı, derece. */
export const PROMPT_BELOW_EYE_DEG = 7;
/** Okuma mesafesinde metin (em) yüksekliğinin açısal boyutu; büyük harf yüksekliği ≈ %70'i. */
export const TEXT_ANGULAR_SIZE_DEG = 2.2;
/** Kural: okuma mesafesinde açısal boyut bunun altına inemez. */
export const TEXT_MIN_ANGULAR_SIZE_DEG = 1.5;
export const TEXT_LINE_HEIGHT = 1.25;
/** Satır genişliği, em cinsinden (60 karakter 2 satıra sığacak şekilde). */
export const TEXT_MAX_WIDTH_EM = 19;
/** Okuma noktasındaki nefes ölçeği: ±%2. */
export const PROMPT_BREATH_SCALE = 0.02;
/** Nefes ölçeğinin okuma noktasına varınca devreye girme / çıkma süresi, saniye. */
export const PROMPT_BREATH_BLEND_S = 5;

/** Font: Türkçe karakterleri tam içeren tek yerel dosya (`public/` altında). */
export const FONT_PATH = 'fonts/NotoSans-Regular.ttf';
/** Build sırasında fontta bulunması zorunlu glifler. */
export const REQUIRED_GLYPHS = 'çğıİöşüÇĞÖŞÜâîûÂÎÛ';

// ---------- Duraklatma ----------
/** Duraklatıldığında sahne bu oranda kararır. */
export const PAUSE_DIM_OPACITY = 0.5;
/** Kararma geçişi (gerçek zaman), saniye. */
export const PAUSE_DIM_FADE_S = 0.8;
/** Durum metninin okuma noktasına göre yukarı kayması, m ve açısal boyutu, derece. */
export const PAUSE_TEXT_OFFSET_Y_M = 0.42;
export const PAUSE_TEXT_ANGULAR_SIZE_DEG = 1.6;

// ---------- Ses ----------
/** Tüm geçişler en az bu kadar sürer, saniye. */
export const AUDIO_MIN_RAMP_S = 2;
export const AUDIO_MASTER_GAIN = 0.8;
/** Duraklatmada ses bu sürede kısılır, sonra AudioContext askıya alınır. */
export const AUDIO_PAUSE_FADE_S = 2;

export const DRONE_BASE_HZ = 98; // G2
export const DRONE_DETUNE_CENTS = [-7, 0, 6] as const;
export const DRONE_OSC_TYPES = ['sawtooth', 'triangle', 'sine'] as const;
export const DRONE_GAIN = 0.16;
export const DRONE_FILTER_HZ = 520;
export const DRONE_FILTER_Q = 0.6;
export const DRONE_LFO_HZ = 0.06;
export const DRONE_LFO_DEPTH_HZ = 180;
/** plateau'da eklenen bir oktav altı katman. */
export const DRONE_PLATEAU_GAIN = 0.12;
export const DRONE_PLATEAU_FADE_S = 8;

export const BELL_BASE_HZ = 392; // G4
/** İnharmonik parçalılar: [frekans oranı, göreli genlik, sönüm süresi sn]. */
export const BELL_PARTIALS = [
  [0.56, 1.0, 9],
  [0.92, 0.67, 7.5],
  [1.19, 0.6, 6],
  [1.71, 0.45, 4.5],
  [2.0, 0.33, 4],
  [2.74, 0.27, 3],
  [3.0, 0.22, 2.6],
  [3.76, 0.15, 2.2],
  [4.07, 0.12, 1.8],
] as const;
export const BELL_GAIN = 0.32;
export const BELL_ATTACK_S = 0.004;
/** Çan HRTF panner ayarları. */
export const BELL_REF_DISTANCE_M = 2;
export const BELL_ROLLOFF = 0.6;
export const BELL_MAX_DISTANCE_M = 60;

// ---------- Performans ----------
export const XR_FOVEATION = 1;
export const XR_TARGET_FRAME_RATE = 90;
export const MAX_PIXEL_RATIO_2D = 2;

// ---------- Kalıcılık ----------
export const STORAGE_KEY_SESSIONS = 'contemplation.sessions';
export const STORAGE_KEY_PREFS = 'contemplation.prefs';

// ---------- Uygulama (giriş, XR oturumu) ----------
/** Art arda gelen select olaylarını (iki el, çift olay) tek duraklatma sayma penceresi, ms. */
export const PAUSE_TOGGLE_DEBOUNCE_MS = 300;
/** Masaüstü/emülatörde duraklat/devam tuşları (KeyboardEvent.code). */
export const PAUSE_KEY_CODES = ['Space'] as const;
/** XR oturumunda istenen isteğe bağlı özellikler. */
export const XR_OPTIONAL_FEATURES = ['local-floor', 'hand-tracking'] as const;
/** "Kaydedildi" bildiriminin ekranda kalma süresi, ms. */
export const SAVED_NOTICE_MS = 2500;
/** Seans başlamadan önce SDF atlasına yüklenen temel karakterler (deste metinleri buna eklenir). */
export const FONT_PRELOAD_BASE_CHARS =
  'abcçdefgğhıijklmnoöprsştuüvyzqwxABCÇDEFGĞHIİJKLMNOÖPRSŞTUÜVYZQWX0123456789 .,;:!?…—–-\'’"“”()«»';

// ---------- [session] modül ek sabitleri ----------

// ---------- [scene] modül ek sabitleri ----------
/** Gökyüzü küresi segmentleri (gradyan parça başına hesaplanır; az segment yeter). */
export const SKY_WIDTH_SEGMENTS = 32;
export const SKY_HEIGHT_SEGMENTS = 16;
/** Gökyüzü gradyanı ufuktan uzaklaştıkça bu üsle değişir (< 1: ufuk bandı dar). */
export const SKY_GRADIENT_EXPONENT = 0.6;
/** return'de gökyüzü ve sis renklerinin yaklaştığı açık renk (RETURN_BRIGHTEN oranında). */
export const MOOD_LIGHT_COLOR = '#5d5aa8';
/** Halkanın zeminden yüksekliği, m. */
export const RING_FLOOR_OFFSET_M = 0.002;
/** Partikül yönü yataydan en fazla bu kadar yukarı eğik, derece; partikül başına hız çarpanı 1 ± JITTER. */
export const PARTICLE_MAX_RISE_DEG = 35;
export const PARTICLE_SPEED_JITTER = 0.4;
/** Partiküller hacmin kenarlarında (yatay ve dikey) bu oranda yumuşakça kaybolur; sarma anında sıçrama olmaz. */
export const PARTICLE_EDGE_FADE_RATIO = 0.15;
/** Çizim sırası: gökyüzü en önce, prompt partiküllerin üstünde, duraklatma katmanı en son. */
export const SKY_RENDER_ORDER = -1;
export const PROMPT_RENDER_ORDER = 1;
export const PAUSE_DIM_RENDER_ORDER = 1000;
export const PAUSE_TEXT_RENDER_ORDER = 1001;
/** Kafaya bağlı kararma küresi; yarıçap CAMERA_NEAR_M'den büyük olmalı. */
export const PAUSE_DIM_RADIUS_M = 0.5;
export const PAUSE_DIM_WIDTH_SEGMENTS = 16;
export const PAUSE_DIM_HEIGHT_SEGMENTS = 8;
/** 2 satıra sığmayan prompt küçültülürken kelime kaydırma için bırakılan pay (çarpan). */
export const PROMPT_SHRINK_MARGIN = 0.95;

// ---------- [audio] modül ek sabitleri ----------
/** Seans seviyesi yumuşatma zaman sabiti (setTargetAtTime): 3τ ≈ %95 → değişim en az AUDIO_MIN_RAMP_S'de oturur. */
export const AUDIO_LEVEL_TIME_CONSTANT_S = AUDIO_MIN_RAMP_S / 3;
/** Fade bittikten sonra kaynağı durdurmadan / bağlamı askıya almadan önce bırakılan pay, sn. */
export const AUDIO_STOP_TAIL_S = 0.1;
/** plateau katmanı: bir oktav altı (frekans oranı) ve dalga biçimi (Quest hoparlöründe 49 Hz sinüs duyulmaz; üçgenin harmonikleri duyulur). */
export const DRONE_PLATEAU_FREQ_RATIO = 0.5;
export const DRONE_PLATEAU_OSC_TYPE = 'triangle' as const;
/** Çan vuruşu: tıkırtısız yumuşak tokmak (BELL_ATTACK_S yerine), sn. */
export const BELL_SOFT_ATTACK_S = 0.04;
/** Parçalıların üstel sönümünün indiği seviye (≈ -80 dB); sonra osilatör durur. */
export const BELL_SILENCE_GAIN = 1e-4;

// ---------- [content] modül ek sabitleri ----------
/** Deste üretim isteğinde en fazla çıktı token'ı (akışsız istek). */
export const DECK_MAX_TOKENS = 16000;
/** Şemayı geçmeyen model çıktısı için yeniden deneme sayısı. */
export const DECK_MAX_RETRIES = 1;
/** Sunucu tarafı ret yedeğini (`fallbacks: 'default'`) destekleyen modeller ve beta başlığı. */
export const DECK_FALLBACK_MODELS = ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1'] as const;
export const DECK_FALLBACK_BETA = 'server-side-fallback-2026-07-01';
/** Tip oranı hedeften bu kadar (mutlak oran) saparsa uyarı verilir. */
export const DECK_TYPE_TOLERANCE = 0.1;
/** Arayüzde gösterilen en fazla şema hatası; fazlası "+N" olarak özetlenir. */
export const DECK_ERROR_MAX_ISSUES = 5;
/** Geçersiz JSON hatasında gösterilen ham çıktı önizlemesi, karakter. */
export const DECK_RAW_PREVIEW_CHARS = 400;
