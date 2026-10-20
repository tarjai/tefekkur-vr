# CLAUDE.md — Tefekkür VR (MVP)

## Proje Özeti

Meta Quest 3 üzerinde, tarayıcıdan (WebXR) çalışan **kişisel düşünce sindirme aracı**. Kullanıcı gözlükle oturur; kendi notlarından üretilmiş kelime/cümleler (prompt) belli aralıklarla derinlikten görüş hizasına yaklaşır, bekler ve geri çekilir. Amaç 30–60 dakika boyunca dikkat dağılmadan, sıkılmadan tek bir konu üzerinde tefekkür etmek.

- **Tek kullanıcı**, kişisel kullanım. Hesap, giriş, backend yok.
- **Tek dil: Türkçe.** `src/config.ts` içinde `LOCALE = "tr"`. Tüm arayüz metinleri `src/strings.ts` içinde, Türkçe. Deste dili ile `LOCALE` aynı olmalı.
- **Türkçe metin kuralları:**
  - Büyük/küçük harf dönüşümü her zaman `toLocaleUpperCase("tr")` / `toLocaleLowerCase("tr")` ile yapılır; `toUpperCase()` yasak (`i → I` hatası, `İ` kaybı).
  - Sıralama ve karşılaştırma `Intl.Collator("tr")` ile.
  - Font `ç ğ ı İ ö ş ü` ve büyük karşılıklarını içermeli.
- İçerik kaynağı: kullanıcının kendi Markdown notları → offline script → deste JSON.

## Teknoloji Yığını

| Katman | Seçim |
|---|---|
| Dil | TypeScript (`strict: true`) |
| Build / dev server | Vite |
| 3D / XR | Three.js + `WebXRManager` (`immersive-vr`) |
| Metin | `troika-three-text` (SDF) |
| Ses | Web Audio API (prosedürel, harici ses dosyası zorunlu değil) |
| Deste üretimi | Node script + `@anthropic-ai/sdk` + `zod` |
| Kalıcılık | `localStorage` (sadece seans günlüğü ve tercihler) |

**Kullanma:** React, Next.js, A-Frame, Babylon.js, herhangi bir UI framework'ü, backend, veritabanı. 2D arayüz düz HTML + CSS + TS.

## Klasör Yapısı

```
/
├─ CLAUDE.md
├─ index.html              # 2D başlangıç ekranı + "VR'a Gir" butonu
├─ vite.config.ts
├─ decks/                  # Deste JSON dosyaları (build'e statik olarak girer)
│  └─ example.json
├─ notes/                  # Kullanıcının ham Markdown notları (git'e girmez)
├─ scripts/
│  └─ build-deck.ts        # notes/*.md → decks/*.json
└─ src/
   ├─ main.ts              # Giriş: UI bağlama, XR session başlatma
   ├─ config.ts            # LOCALE, süreler, mesafeler, renkler — tüm sihirli sayılar burada
   ├─ strings.ts           # Arayüz metinleri (tek dil)
   ├─ deck/
   │  ├─ schema.ts         # zod şeması + tipler (script ile ortak)
   │  └─ loader.ts
   ├─ session/
   │  ├─ clock.ts          # Seans saati (timeScale destekli)
   │  ├─ planner.ts        # Desteden zaman çizelgesi üretir
   │  └─ runner.ts         # Çizelgeyi saate göre oynatır, olay yayar
   ├─ scene/
   │  ├─ environment.ts    # Gökyüzü gradyanı, sis, zemin halkası, partiküller
   │  ├─ promptView.ts     # Tek prompt'un görsel yaşam döngüsü
   │  └─ breath.ts         # Nefes ritmi sinyali (0..1)
   ├─ audio/
   │  ├─ engine.ts         # AudioContext, master gain, fade'ler
   │  ├─ drone.ts          # Prosedürel pad
   │  └─ bell.ts           # Prosedürel çan
   ├─ input/
   │  └─ pause.ts          # select olayı → duraklat/devam
   └─ log/
      └─ sessionLog.ts     # Gösterilen prompt'lar, duraklatmalar, kapanış cevabı
```

## Deste Formatı

`src/deck/schema.ts` tek doğruluk kaynağıdır; script ve uygulama aynı şemayı kullanır.

```ts
type PromptType = "anchor" | "question" | "koan" | "quote" | "sensory";

interface Prompt {
  id: string;            // "p01" ...
  type: PromptType;
  text: string;          // en fazla 60 karakter, en fazla 2 satır
  sourceNote?: string;   // hangi nottan geldiği (dosya adı)
}

interface Deck {
  id: string;
  title: string;
  locale: string;        // config.LOCALE ile eşleşmeli, eşleşmezse uyarı ver
  anchor: string;        // çekirdek kavram, tek kelime veya kısa ifade
  prompts: Prompt[];     // çağrışım sırasına göre dizilmiş, 40–80 adet
  closing: string;       // seans sonu sorusu (ör. "Ne kaldı?" karşılığı)
}
```

**Tip dağılımı hedefi (deste başına):** anchor 1 (tekrar eden), question %35, koan %20, quote %15, sensory %20, kalan serbest.

## Deste Üretim Script'i (`scripts/build-deck.ts`)

```
npx tsx scripts/build-deck.ts notes/zaman.md --out decks/zaman.json
```

- Girdi: bir veya birden fazla Markdown dosyası.
- Model: `ANTHROPIC_MODEL` env değişkeni, varsayılan `claude-sonnet-5-5`. Anahtar: `ANTHROPIC_API_KEY`.
- Dil: `--locale` parametresi, yoksa `config.LOCALE` (`tr`). Model çıktısı Türkçe olmalı; notlar başka dilde olsa bile prompt'lar Türkçe üretilir.
- Model talimatı şunları istemeli:
  - Notlardaki çekirdek kavramı `anchor` olarak çıkar.
  - Prompt'ları **çağrışımsal sürüklenme** sırasıyla diz: her prompt bir öncekiyle bağlantılı ama tekrar değil.
  - Sorular kullanıcıya doğrudan yönelsin, açıklama veya cevap içermesin.
  - Notlardaki somut fikirleri soruya dönüştür; genel motivasyon cümlesi üretme.
  - Sadece JSON döndür.
- Çıktıyı `zod` ile doğrula; geçmezse hatayı göster, bir kez yeniden dene, yine geçmezse dur.
- 60 karakteri aşan prompt'ları reddet ve raporla (sessizce kırpma).

## Seans Motoru

### Fazlar

Toplam süre `D` (kullanıcı seçer: 30 / 45 / 60 dk). Oranlar `config.ts` içinde:

| Faz | Oran | Davranış |
|---|---|---|
| `arrival` | %8 | Prompt yok. Sadece nefes pulsu + ses fade-in |
| `seed` | %10 | `anchor` tek başına, uzun süre görünür |
| `deepening` | %60 | Prompt'lar sırayla; her 5 prompt'ta bir `anchor` tekrar |
| `plateau` | %14 | Prompt yok; ortam hafif koyulaşır, drone bir katman kazanır |
| `return` | %8 | `anchor` son kez gelir, sonra `closing`; ortam aydınlanır, ses fade-out |

### Görünme Süreleri (saniye, `config.ts`)

| Tip | Süre |
|---|---|
| anchor | 75 |
| question / koan / quote | 40 |
| sensory | 18 |

**Prompt'lar arası sessizlik:** prompt süresinin 1.2–1.8 katı arasında rastgele (seed'li RNG, aynı deste + süre = aynı çizelge).

**Kısıt:** `deepening` fazında prompt görünür süresi fazın %40'ını geçmemeli. Deste uzunsa `planner` sondan prompt düşürür; kısaysa sessizlikleri uzatır (prompt tekrarlamaz).

### Planner Çıktısı

`planner.ts` saf fonksiyon: `(deck, durationMs, seed) => Timeline`. Timeline, mutlak zaman damgalı olay listesidir (`phaseStart`, `promptShow`, `promptHide`, `bell`, `sessionEnd`). Birim test yazılacak tek yer burası; olay sırası ve %40 kısıtı test edilmeli.

### Saat

- Tüm animasyonlar **zaman tabanlı**, kare tabanlı değil. XR frame callback'indeki zaman kullanılır.
- `?speed=N` URL parametresi `timeScale` ayarlar (geliştirmede 45 dk'yı ~2 dk'da izlemek için).
- Duraklatma saati dondurur; ses ve animasyonlar da donar.

## Görsel Kurallar

### Sahne (MVP: soyut boşluk)

- Kullanıcı sabit, oturur pozisyon. **Hiçbir lokomosyon, kamera hareketi veya sahne dönüşü yok.**
- Gökyüzü: koyu lacivert → mor dikey gradyan. **Saf siyah kullanma** (Quest 3 LCD'de gri görünür).
- Yerde, kullanıcının ~1 m önünde ince ışık halkası: sabit görsel referans; parlaklığı nefes sinyaliyle değişir.
- Hafif üstel sis, az sayıda (≤ 500) yavaş süzülen partikül.
- Gölge yok, post-processing yok.

### Prompt Animasyonu

| Parametre | Değer |
|---|---|
| Başlangıç mesafesi | 12 m |
| Okuma mesafesi | 2 m |
| Dikey konum | Göz hizasının 7° altı |
| Yaklaşma süresi | 2 nefes döngüsü (20 sn) |
| Geri çekilme süresi | 1 nefes döngüsü (10 sn) |
| Eğri | ease-in-out |
| Opaklık | 0 → 1 yaklaşırken, 1 → 0 geri çekilirken |
| Metin yüksekliği | okuma mesafesinde ≥ 1.5° açısal boyut |
| Satır | en fazla 2, ortalı |

- Prompt pozisyonu seans başında kullanıcının bakış yönüne göre bir kez sabitlenir; baş hareketini takip etmez.
- Font: Türkçe karakterleri tam destekleyen tek bir yerel font dosyası (`public/fonts/`), Latin Extended-A kapsamlı. Öneri: Inter veya Noto Sans. Build sırasında `çğıİöşüÇĞÖŞÜ` glif kontrolü yapılmalı; eksik glif varsa build hata vermeli.

### Nefes Sinyali

`breath.ts`: periyot 10 sn (5 al / 5 ver), sinüs, 0..1. Halka parlaklığı, partikül hızı ve prompt'un okuma noktasındaki çok hafif ölçek nefesi (±%2) bu sinyale bağlı.

## Ses

- Tek `AudioContext`, kullanıcı "VR'a Gir"e bastığında başlatılır.
- **Drone:** 2–3 detune oscillator + lowpass filtre + yavaş LFO. `plateau` fazında bir oktav altı katman eklenir.
- **Çan:** prompt belirirken tek vuruş; inharmonik sinüs parçalıları + uzun exponential decay. Prosedürel üretilir.
- Çan, prompt'un sahnedeki konumundan `PannerNode` (`panningModel: "HRTF"`) ile çalınır.
- Tüm geçişler en az 2 sn gain ramp; ani ses yok.

## Etkileşim

- 2D başlangıç ekranı: deste seçimi, süre seçimi (30/45/60), "VR'a Gir".
- VR içinde tek etkileşim: herhangi bir `select` olayı (kontrolcü tetiği veya el takibinde pinch) → duraklat/devam. Duraklatıldığında sahne %50 kararır, küçük bir durum metni görünür.
- Seans bitince XR session sonlandırılır, 2D ekrana dönülür.

## Seans Sonrası (Sindirme Kaydı)

- 2D ekranda deste `closing` sorusu + metin alanı.
- `sessionLog` şunları tutar: tarih, deste id, süre, gösterilen prompt id'leri, duraklatılan prompt id'leri (o an ekranda olan), kapanış cevabı.
- `localStorage` anahtarı: `contemplation.sessions`.
- "Dışa aktar" butonu: tüm seansları tek Markdown dosyası olarak indirir.

## Performans ve Konfor Bütçesi

- Hedef 90 Hz, kare başına < 11 ms. 72 Hz'e düşüş kabul edilebilir, altı değil.
- `renderer.xr.setFoveation(1)`.
- Draw call < 50, toplam üçgen < 100k.
- Aynı anda en fazla 1 prompt mesh'i sahnede.

## Geliştirme Akışı

- `npm run dev` — Vite dev server.
- Masaüstü test: Chrome + Immersive Web Emulator eklentisi.
- Quest testi (tercih edilen): USB ile bağla, `adb reverse tcp:5173 tcp:5173`, Quest Browser'da `http://localhost:5173` (localhost güvenli bağlam sayılır, HTTPS gerekmez).
- Alternatif: `@vitejs/plugin-basic-ssl` ile LAN üzerinden HTTPS.
- `npm run build` — statik çıktı, herhangi bir statik hosting'e konabilir.

## Kodlama Kuralları

- Sihirli sayı yok; tüm süreler, mesafeler, oranlar, renkler `config.ts` içinde.
- Modüller küçük ve tek sorumluluklu. `runner` olay yayar, sahne ve ses dinler; birbirini doğrudan çağırmazlar.
- `planner` saf ve test edilebilir; DOM, Three.js veya Web Audio'ya dokunmaz.
- Dispose disiplini: kaldırılan prompt'un geometri, materyal ve troika nesnesi serbest bırakılır.
- Yeni bağımlılık eklemeden önce gerekçe yaz.

## MVP Kapsamı Dışında (v2+)

Bunları **yapma**, gerekirse sadece arayüz noktası bırak:

- Embedding tabanlı semantik zincir (MVP'de sıra script'ten gelir).
- El jestleri (dondur / derinleş / geç).
- Astronot, okyanus, sisli göl sahneleri.
- TTS / fısıltı ses katmanı.
- Uyku ve dağılma tespiti (baş eğimi, bakış varyansı).
- Passthrough'a geçişle çıkış.
- Seans haritası görselleştirmesi ve aralıklı tekrar algoritması.
- Supabase senkronizasyonu.

## Bitti Tanımı (MVP)

1. `build-deck` script'i bir Markdown notundan şemaya uyan deste üretiyor.
2. 2D ekrandan deste ve süre seçilip Quest 3'te VR'a girilebiliyor.
3. Beş faz doğru oranlarda oynuyor; `?speed=30` ile baştan sona izlenebiliyor.
4. Prompt'lar yaklaşıyor, okunuyor, geri çekiliyor; nefes pulsu ile senkron.
5. Drone ve çan çalışıyor, ani ses geçişi yok.
6. Duraklat/devam çalışıyor.
7. Seans sonunda kapanış cevabı kaydediliyor ve Markdown olarak dışa aktarılabiliyor.
8. Quest 3'te 45 dk boyunca 72 Hz altına düşmüyor.
