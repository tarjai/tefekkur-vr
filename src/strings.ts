// Arayüz metinleri (tek dil: Türkçe). Başka modüller kullanıcıya görünen metin yazmaz.

export const STRINGS = {
  appTitle: 'Tefekkür',
  appSubtitle: 'Tek bir konu, sessiz bir boşluk. Sadece otur ve bak.',
  deckLabel: 'Deste',
  durationLabel: 'Süre',
  minutes: (n: number) => `${n} dk`,
  promptCount: (n: number) => `${n} prompt`,
  enterVr: "VR'a Gir",
  starting: 'Başlatılıyor…',
  xrChecking: 'WebXR denetleniyor…',
  xrUnsupported:
    'Bu tarayıcı immersive-vr desteklemiyor. Quest Browser ile aç ya da adresin sonuna ?emu ekleyerek emülatörü dene.',
  xrStartFailed: (message: string) => `VR oturumu başlatılamadı: ${message}`,
  emulatorActive: 'Emülatör (IWER) etkin',
  speedActive: (n: number) => `Hız: ${n}×`,
  noDecks: 'Geçerli deste bulunamadı. decks/ klasörüne şemaya uyan bir JSON ekle.',
  deckInvalid: (file: string, message: string) => `Geçersiz deste (${file}): ${message}`,
  deckDuplicateId: (id: string, keptFile: string) => `id "${id}" zaten ${keptFile} tarafından kullanılıyor.`,
  localeMismatch: (deckLocale: string, appLocale: string) =>
    `Uyarı: deste dili (${deckLocale}) uygulama diliyle (${appLocale}) eşleşmiyor.`,

  // VR içi
  paused: 'Duraklatıldı',
  pausedHint: 'Devam etmek için tetiğe bas ya da parmaklarını kıstır',

  // Seans sonrası
  closingTitle: 'Sindirme kaydı',
  closingEarly: 'Seans erken sonlandı. Yine de aklında kalanı yazabilirsin.',
  closingPlaceholder: 'Aklında kalanı yaz…',
  save: 'Kaydet',
  skip: 'Atla',
  saved: 'Kaydedildi.',
  backToStart: 'Başa dön',

  // Seans günlüğü
  sessionsCount: (n: number) => (n === 0 ? 'Henüz kayıtlı seans yok.' : `${n} kayıtlı seans`),
  exportMarkdown: 'Dışa aktar (Markdown)',
  storageUnavailable: 'Tarayıcı depolaması kullanılamıyor; seans kaydedilemedi.',

  // Markdown dışa aktarım
  exportTitle: 'Tefekkür Seansları',
  exportFileName: (isoDate: string) => `tefekkur-seanslari-${isoDate}.md`,
  exportDeck: 'Deste',
  exportDuration: 'Süre',
  exportElapsed: 'Geçen süre',
  exportCompleted: 'Tamamlandı',
  exportShown: "Gösterilen prompt'lar",
  exportPaused: "Duraklatılan prompt'lar",
  exportClosing: 'Kapanış sorusu',
  exportAnswer: 'Kapanış cevabı',
  exportNone: '—',
  yes: 'evet',
  no: 'hayır',
} as const;
